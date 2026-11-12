/* ============ SETTINGS: YOUR ONLINE DATABASE (SUPABASE) ============ */
// Leave both empty to keep using the browser-only demo accounts.
// Fill both in (see database-setup.sql and the steps I gave you) to use real, shared accounts.
var SUPABASE_URL = "https://syuzulohxubhliafuqkq.supabase.co";    // for example "https://abcdefgh.supabase.co"
var SUPABASE_KEY = "sb_publishable_UnUcB1v4omYreAwClYtxZA_dpLiUjHi";    // the PUBLISHABLE key, starts with sb_publishable_ (never the secret key!)
var CLOUD = SUPABASE_URL !== "" && SUPABASE_KEY !== "";

/* ============ 0. SPEED: REMEMBER TMDB ANSWERS DURING YOUR VISIT ============ */
// Asking TMDB for the same thing twice is slow, so answers are saved until you close the tab.
var realFetch = window.fetch.bind(window);
window.fetch = async function (url, options) {
  if (typeof url === "string" && url.indexOf("https://api.themoviedb.org") === 0) {
    var cacheKey = "tmdb:" + url.replace(/api_key=[^&]*/, "");
    try {
      var saved = sessionStorage.getItem(cacheKey);
      if (saved) { return new Response(saved, { status: 200, headers: { "Content-Type": "application/json" } }); }
    } catch (e) {}
    var response = await realFetch(url, options);
    if (response.ok) { try { sessionStorage.setItem(cacheKey, await response.clone().text()); } catch (e) {} }
    return response;
  }
  return realFetch(url, options);
};

/* ============ 0b. ALWAYS START ON THE HOME PAGE ============ */
// (after logging in or out the page reloads and goes back to where you were)
(function () {
  var go = null;
  try { go = sessionStorage.getItem("goto"); sessionStorage.removeItem("goto"); } catch (e) {}
  history.replaceState(null, "", go || "#home");
})();

/* ============ 1. SHOW ONE PAGE AT A TIME ============ */
// Each page is a <div class="page" id="...">. The link (#movies, #tv ...) decides which one shows.
function showPage() {
  var parts = location.hash.replace("#", "").split("/");      // "#member/anton123" -> ["member", "anton123"]
  var name = parts[0] || "home";
  if (!document.getElementById(name)) { name = "home"; }

  // The Profile needs a login. The Login page is pointless if you are already logged in.
  if ((name === "profile" || name === "people" || name === "member") && !currentUser()) {
    returnTo = location.hash || "#" + name;
    showMessage("Please log in to see this page.");
    location.hash = "#login";
    return;
  }
  if (name === "login" && currentUser()) { location.hash = "#profile"; return; }

  document.querySelectorAll(".page").forEach(function (page) {
    page.classList.toggle("active", page.id === name);
  });

  // Highlight the menu link (the login page highlights "Profile")
  var menuName = (name === "login") ? "profile" : (name === "member" ? "people" : name);
  document.querySelectorAll("nav a").forEach(function (link) {
    link.classList.toggle("active", link.getAttribute("href") === "#" + menuName);
  });
  window.scrollTo(0, 0);
  if (name === "member") {                      // wait a moment so the rest of script.js has loaded
    var who = decodeURIComponent(parts[1] || "");
    setTimeout(function () { loadMember(who); }, 0);
  }
}
window.addEventListener("hashchange", showPage);
showPage();

/* ============ 2. SMALL POP-UP MESSAGE ============ */
function showMessage(text, kind) {
  var box = document.getElementById("message");
  box.textContent = text;
  box.className = "show" + (kind === "error" ? " error" : "");
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(function () { box.className = ""; }, 2800);
}

/* ============ 3. "ADD TO LIST" BUTTONS ============ */
document.querySelectorAll(".add").forEach(function (button) {
  button.onclick = function () { showMessage("Done! (Connect a database to save this.)"); };
});

/* ============ 4. SEARCH ============ */
// The search drop-down list is in section 10 at the bottom of this file.

/* ============ 5. THEATER: SEATS, DATE AND SHOWTIMES ============ */
var TICKET_PRICE = 340;      // price of one seat in pesos (database-bookings.sql uses 340 too)
var chosen = [];             // seats the visitor picked
var bookedSeats = [];        // seats other people already booked for this showtime
var lastSeatKey = "";
var seatBox = document.getElementById("seats");

// make rows A-H with 15 seats each (A6 to A10 are wheelchair spaces)
"ABCDEFGH".split("").forEach(function (row) {
  var rowDiv = document.createElement("div"); rowDiv.className = "seat-row";
  var letter = document.createElement("span"); letter.className = "row-label"; letter.textContent = row;
  rowDiv.appendChild(letter);                       // the row letter (A to H) on the left
  for (var n = 1; n <= 15; n++) {
    var seat = document.createElement("button");
    seat.className = "seat";
    seat.title = row + n;
    seat.setAttribute("aria-label", "Seat " + row + n);
    if (row === "A" && n >= 6 && n <= 10) { seat.classList.add("wheelchair"); seat.textContent = "♿"; }
    seat.onclick = function () {
      var seatId = this.title;
      if (this.classList.contains("taken")) { return; }
      this.classList.toggle("selected");
      if (chosen.includes(seatId)) { chosen.splice(chosen.indexOf(seatId), 1); }
      else {
        if (chosen.length >= 10) { this.classList.remove("selected"); showMessage("You can book up to 10 seats at a time.", "error"); return; }
        chosen.push(seatId);
      }
      updateSummary();
    };
    rowDiv.appendChild(seat);
  }
  seatBox.appendChild(rowDiv);
});
// seat numbers (1 to 15) under the last row
var numberRow = document.createElement("div"); numberRow.className = "seat-row";
numberRow.appendChild(document.createElement("span"));
for (var num = 1; num <= 15; num++) {
  var label = document.createElement("span"); label.className = "row-label"; label.textContent = num;
  numberRow.appendChild(label);
}
seatBox.appendChild(numberRow);

// time buttons
document.querySelectorAll("#times button").forEach(function (b) {
  b.onclick = function () {
    document.querySelectorAll("#times button").forEach(function (x) { x.classList.remove("chosen"); });
    b.classList.add("chosen");
    updateSummary();
  };
});

// One showtime = movie + cinema + date + time. Seats are saved against this key.
function bookingKey() {
  var chosenTime = document.querySelector("#times .chosen");
  return [document.getElementById("bookTitle").textContent, document.getElementById("cinema").value,
          document.getElementById("date").value, chosenTime ? chosenTime.textContent : ""].join("|");
}
function paintSeats() {
  document.querySelectorAll("#seats .seat").forEach(function (b) {
    b.classList.toggle("taken", bookedSeats.includes(b.title));
    b.classList.toggle("selected", chosen.includes(b.title));
  });
}
function updateSummary() {
  if (bookingKey() !== lastSeatKey) { lastSeatKey = bookingKey(); chosen = []; bookedSeats = []; paintSeats(); loadBookedSeats(); }
  var chosenTime = document.querySelector("#times .chosen");
  document.getElementById("sumMovie").textContent = document.getElementById("bookTitle").textContent;
  document.getElementById("sumCinema").textContent = document.getElementById("cinema").value;
  var d = document.getElementById("date").value.split("-");
  document.getElementById("sumTime").textContent =
    (d.length === 3 ? new Date(+d[0], +d[1] - 1, +d[2]).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric", weekday: "short" }) : "") +
    " • " + (chosenTime ? chosenTime.textContent : "");
  document.getElementById("sumSeats").textContent = chosen.join(", ") || "None";
  document.getElementById("sumTotal").textContent = "₱ " + (chosen.length * TICKET_PRICE).toFixed(2);
}
document.getElementById("cinema").onchange = updateSummary;

// ---- Real date and time (Philippine time): today by default; showtimes that already started are disabled ----
function manilaNow() { return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" })); }
function pad2(n) { return String(n).padStart(2, "0"); }
function isoOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function todayISO() { return isoOf(manilaNow()); }
function minutesOf(label) {
  var p = label.match(/(\d+):(\d+) (AM|PM)/), h = (+p[1]) % 12 + (p[3] === "PM" ? 12 : 0);
  return h * 60 + (+p[2]);
}
function showHasStarted(date, time) {
  var now = manilaNow(), today = isoOf(now);
  if (date < today) { return true; }
  if (date > today) { return false; }
  return minutesOf(time) <= now.getHours() * 60 + now.getMinutes();
}
function refreshTimes() {
  var dateBox = document.getElementById("date");
  var now = manilaNow(), nowMin = now.getHours() * 60 + now.getMinutes();
  var buttons = Array.from(document.querySelectorAll("#times button"));
  buttons.forEach(function (b) {
    b.disabled = dateBox.value === todayISO() && minutesOf(b.textContent) <= nowMin;
  });
  var open = buttons.filter(function (b) { return !b.disabled; });
  if (open.length === 0) {                       // no more shows today: go to tomorrow
    var next = manilaNow(); next.setDate(next.getDate() + 1);
    dateBox.value = isoOf(next);
    return refreshTimes();
  }
  var chosenBtn = document.querySelector("#times .chosen");
  if (!chosenBtn || chosenBtn.disabled) {
    buttons.forEach(function (x) { x.classList.remove("chosen"); });
    open[0].classList.add("chosen");
  }
}
(function () {
  var dateBox = document.getElementById("date");
  var last = manilaNow(); last.setDate(last.getDate() + 30);
  dateBox.min = todayISO(); dateBox.max = isoOf(last); dateBox.value = todayISO();
  refreshTimes(); updateSummary();
})();
document.getElementById("date").onchange = function () {
  if (this.value < todayISO()) { this.value = todayISO(); showMessage("You can only book today or a later date.", "error"); }
  refreshTimes(); updateSummary();
};

/* ============ 6. LOGIN FORM ============ */
var signUpMode = false;

// show / hide password
document.getElementById("showPass").onchange = function () {
  document.getElementById("pass").type = this.checked ? "text" : "password";
};

// switch between Sign In and Sign Up
document.getElementById("switchLink").onclick = function (e) {
  e.preventDefault();
  signUpMode = !signUpMode;
  document.getElementById("formTitle").textContent = signUpMode ? "Create your account" : "Welcome to Filmlify";
  document.getElementById("submitBtn").textContent = signUpMode ? "Sign Up" : "Sign In";
  document.getElementById("emailBox").style.display = signUpMode ? "block" : "none";
  document.querySelector('label[for="user"]').textContent = signUpMode ? "Username" : (CLOUD ? "Email" : "Email or Username");
  document.getElementById("switchText").textContent = signUpMode ? "Already have an account?" : "Don't have an account?";
  this.textContent = signUpMode ? "Sign In" : "Sign Up";
};

// check the form when the button is pressed
document.getElementById("loginForm").onsubmit = async function (e) {
  e.preventDefault();
  var user = document.getElementById("user").value.trim();
  var email = document.getElementById("email").value.trim();
  var pass = document.getElementById("pass").value;
  var errors = { user: "", email: "", pass: "" };

  if (!user) { errors.user = signUpMode ? "Please choose a username." : "Please enter your email or username."; }
  if (!pass) { errors.pass = "Please enter your password."; }

  if (signUpMode) {
    if (user && user.length < 3) { errors.user = "Username needs at least 3 characters."; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { errors.email = "Please enter a valid email."; }
    if (pass && pass.length < 6) { errors.pass = "Password needs at least 6 characters."; }
  }

  if (!errors.user && !errors.email && !errors.pass) {
    if (CLOUD) {
      var problem = await cloudAuth(signUpMode, user, email, pass);     // "" when it worked (the page reloads)
      if (problem) { document.getElementById("passError").textContent = problem; }
      return;
    }
    var list = accounts();
    if (signUpMode) {
      var taken = list.some(function (a) { return a.username.toLowerCase() === user.toLowerCase() || a.email.toLowerCase() === email.toLowerCase(); });
      if (taken) { errors.user = "That username or email is already registered."; }
      else {
        var salt = Math.random().toString(36).slice(2);
        list.push({ username: user, email: email, salt: salt, hash: await hashPassword(pass, salt) });
        localStorage.setItem("filmlify_accounts", JSON.stringify(list));
        finishLogin(user, "Welcome to Filmlify, " + user + "!");
        return;
      }
    } else {
      var account = list.find(function (a) { return a.username.toLowerCase() === user.toLowerCase() || a.email.toLowerCase() === user.toLowerCase(); });
      if (!account) { errors.user = "No account found. Please sign up first."; }
      else if (await hashPassword(pass, account.salt) !== account.hash) { errors.pass = "Wrong password."; }
      else { finishLogin(account.username, "Welcome back, " + account.username + "!"); return; }
    }
  }
  document.getElementById("userError").textContent = errors.user;
  document.getElementById("emailError").textContent = errors.email;
  document.getElementById("passError").textContent = errors.pass;
};

// Google button (needs a Google account setup + server to really work)
document.getElementById("googleBtn").onclick = function () {
  showMessage("Google sign-in needs setup first.");
};


/* ============ 7. TMDB API: REAL POSTERS AND BACKGROUNDS ============ */
// NOTE: anyone can see this key in the page source. Fine for a personal project;
// for a public website, move the API calls to a server.
var TMDB_KEY = "9bac28ec4c4699d299b9cc8039e654f7";
var TMDB_URL = "https://api.themoviedb.org/3";
var POSTER_URL = "https://image.tmdb.org/t/p/w342";      // poster size
var PROFILE_URL = "https://image.tmdb.org/t/p/w185";    // people photos
var BACKDROP_URL = "https://image.tmdb.org/t/p/w1280";   // big background size
var searchCache = {};                                    // remembers titles we already looked up

// Look up a title (movie or TV show) and return the best match, or null if none
async function searchTMDB(title) {
  if (title in searchCache) { return searchCache[title]; }
  try {
    var response = await fetch(TMDB_URL + "/search/multi?query=" + encodeURIComponent(title) + "&api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    var match = (data.results || []).find(function (item) {
      return (item.media_type === "movie" || item.media_type === "tv") && item.poster_path;
    });
    searchCache[title] = match || null;
    return searchCache[title];
  } catch (error) {
    console.error("TMDB lookup failed for '" + title + "':", error);
    return null;      // the card simply keeps its colored placeholder
  }
}

// Put a real poster on every card (6 at a time, to stay under TMDB's request limit)
async function loadPosters() {
  // only cards that do not have a poster yet
  var cards = Array.from(document.querySelectorAll(".card")).filter(function (card) {
    return !card.querySelector(".has-image");
  });
  for (var i = 0; i < cards.length; i += 6) {
    await Promise.all(cards.slice(i, i + 6).map(async function (card) {
      var item = await searchTMDB(card.querySelector("b").textContent);
      if (item) {
        var poster = card.querySelector(".poster");
        poster.style.backgroundImage = "url(" + POSTER_URL + item.poster_path + ")";
        poster.classList.add("has-image");
      }
    }));
  }
}

// Put a real background on every banner that has data-title="..."
async function loadBackdrops() {
  var banners = document.querySelectorAll(".hero[data-title]");
  for (var i = 0; i < banners.length; i++) {
    var item = await searchTMDB(banners[i].dataset.title);
    if (item && item.backdrop_path) {
      banners[i].style.backgroundImage =
        "linear-gradient(90deg, #0b1124dd, #0b112455), url(" + BACKDROP_URL + item.backdrop_path + ")";
      banners[i].style.backgroundSize = "cover";
      banners[i].style.backgroundPosition = "center";
    }
  }
}

// The three hover buttons use drawn icons (not text symbols) so they sit perfectly centered
var QUICK_ICONS = {
  like: '<svg viewBox="0 0 24 24"><path d="M12 20.5l-1.2-1.1C5.9 15.1 3 12.4 3 9a4.5 4.5 0 0 1 8-2.8h2A4.5 4.5 0 0 1 21 9c0 3.4-2.9 6.1-7.8 10.4z"/></svg>',
  watched: '<svg viewBox="0 0 24 24"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg>',
  watchlist: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'
};

// Make one poster card from a movie/show that TMDB sent us
function makeCard(m) {
  var card = document.createElement("div");
  card.className = "card";
  card.dataset.key = remember(m);   // so a click can open this movie's pop-up

  var poster = document.createElement("div");
  poster.className = "poster has-image";
  poster.style.backgroundImage = "url(" + POSTER_URL + m.poster_path + ")";

  var title = document.createElement("b");
  title.textContent = m.title || m.name;

  var info = document.createElement("small");
  var date = m.release_date || m.first_air_date || "";
  var rating = m.vote_average ? "★ " + m.vote_average.toFixed(1) + " • " : "";
  info.textContent = rating + date.slice(0, 4);

  var quick = document.createElement("div");            // buttons that appear when you hover a poster
  quick.className = "quick";
  [["♥", "like", "Like"], ["✓", "watched", "Mark as watched"], ["+", "watchlist", "Add to watchlist"]].forEach(function (b) {
    var button = document.createElement("button");
    button.innerHTML = QUICK_ICONS[b[1]];
    button.setAttribute("aria-label", b[2]);
    button.dataset.action = b[1];
    button.title = b[2];
    quick.appendChild(button);
  });
  poster.appendChild(quick);

  card.appendChild(poster);
  card.appendChild(title);
  card.appendChild(info);
  return card;
}

// Every row that has data-source="..." in index.html gets filled with up to 20 titles.
// To change what a row shows, change its data-source (for example /movie/popular).
async function fillRows() {
  var rows = Array.from(document.querySelectorAll(".row[data-source]"));
  await Promise.all(rows.map(async function (row) {
    try {
      var source = row.dataset.source;
      var joiner = source.includes("?") ? "&" : "?";
      var response = await fetch(TMDB_URL + source + joiner + "api_key=" + TMDB_KEY);
      if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
      var data = await response.json();
      var items = (data.results || []).filter(function (m) { return m.poster_path; });
      if (items.length === 0) { return; }       // keep the cards typed in index.html
      row.replaceChildren();
      items.forEach(function (m) { row.appendChild(makeCard(m)); });
      row.scrollLeft = 0;
    } catch (error) {
      console.error("Could not fill row " + row.dataset.source + ":", error);
    }
  }));
}

async function loadEverything() {
  fillEpisodes();          // 0. New Episodes This Week (loads by itself)
  await Promise.all([fillRows(), fillPeople()]);   // 1. long rows + trending people from TMDB
  addBookNowButtons();      // 1b. "Book Now" under every Now Showing poster
  loadPosters();            // 2. posters for any cards typed by hand (like your Profile)
  loadBackdrops();          // 3. banner backgrounds
  loadIcons();              // 3b. small pictures (news, spotlight, directors)
  updateAllArrows();        // 4. refresh the slider arrows (from section 8)
}
loadEverything();


/* ============ 8. SLIDER ARROWS ON EVERY POSTER ROW ============ */
// For each row of posters, this adds a "<" and a ">" button that slide the row.
// How far one arrow click slides: a whole number of cards, so posters always line up neatly
function cardStep(row) {
  var first = row.firstElementChild;
  if (!first) { return row.clientWidth; }
  var gap = parseFloat(getComputedStyle(row).columnGap) || 14;
  var one = first.getBoundingClientRect().width + gap;
  return Math.max(1, Math.floor(row.clientWidth / one)) * one;
}

var allRows = document.querySelectorAll(".row:not(.wrap)");   // wrapped grids (Browse) need no slider arrows

allRows.forEach(function (row) {
  // wrap the row in a box so the arrows can sit on top of it
  var slider = document.createElement("div");
  slider.className = "slider";
  row.parentNode.insertBefore(slider, row);

  var leftArrow = document.createElement("button");
  leftArrow.className = "arrow left";
  leftArrow.textContent = "‹";
  leftArrow.setAttribute("aria-label", "Scroll left");

  var rightArrow = document.createElement("button");
  rightArrow.className = "arrow right";
  rightArrow.textContent = "›";
  rightArrow.setAttribute("aria-label", "Scroll right");

  slider.appendChild(leftArrow);
  slider.appendChild(row);
  slider.appendChild(rightArrow);

  // slide by about 80% of the visible width each click
  leftArrow.onclick = function () {
    row.scrollBy({ left: -cardStep(row), behavior: "smooth" });
  };
  rightArrow.onclick = function () {
    row.scrollBy({ left: cardStep(row), behavior: "smooth" });
  };

  // show or hide the arrows depending on whether there is more to scroll to
  row.updateArrows = function () {
    var canScroll = row.scrollWidth > row.clientWidth + 1;
    leftArrow.classList.toggle("hidden", !canScroll || row.scrollLeft <= 0);
    rightArrow.classList.toggle("hidden", !canScroll || row.scrollLeft + row.clientWidth >= row.scrollWidth - 1);
  };
  row.addEventListener("scroll", row.updateArrows);
});

function updateAllArrows() {
  allRows.forEach(function (row) { row.updateArrows(); });
}
window.addEventListener("resize", updateAllArrows);
window.addEventListener("hashchange", updateAllArrows);                // a different page was opened
document.getElementById("search").addEventListener("input", updateAllArrows);  // search hid some posters
updateAllArrows();


/* ============ 9. MOVIE POP-UP, REVIEWS AND WATCHLIST ============ */
var known = {};         // every movie/show we have seen, saved under a key like "movie-550"
var current = null;     // the movie/show that is open in the pop-up
var chosenStars = 0;    // the rating picked in the pop-up (1 to 5)

function remember(m) {
  m.media_type = m.media_type || (m.first_air_date !== undefined ? "tv" : "movie");
  var key = m.media_type + "-" + m.id;
  known[key] = m;
  return key;
}
function nameOf(m) { return m.title || m.name; }
function yearOf(m) { return (m.release_date || m.first_air_date || "").slice(0, 4); }
function starText(n) { return "★".repeat(n) + "☆".repeat(5 - n); }

// Reviews and watchlist are saved in the browser (localStorage), so they stay after refreshing.
// To keep them on a server later, replace these two functions.
function getList(name) {
  var key = userKey(name);                       // every account has its own reviews, watchlist, etc.
  if (!key) { return []; }                       // nobody is logged in
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
}
function saveList(name, list) {
  var key = userKey(name);
  if (!key) { return; }
  try { localStorage.setItem(key, JSON.stringify(list)); }
  catch (e) { showMessage("Could not save: your browser blocked storage."); }
}

// Build one review row for the page
function reviewElement(r, showTitle) {
  var row = document.createElement("div");
  row.className = "item";
  var inner = document.createElement("span");

  if (showTitle) {
    var title = document.createElement("b");
    title.textContent = r.title + " ";
    inner.appendChild(title);
  }
  var starsEl = document.createElement("span");
  starsEl.className = "star";
  starsEl.textContent = starText(r.stars);
  inner.appendChild(starsEl);

  if (r.text) {
    inner.appendChild(document.createElement("br"));
    inner.appendChild(document.createTextNode(r.text));
  }
  var date = document.createElement("small");
  date.textContent = "Reviewed " + r.date;
  inner.appendChild(document.createElement("br"));
  inner.appendChild(date);

  if (showTitle) {                                   // Profile reviews get a small poster icon
    var thumb = document.createElement("div");
    thumb.className = "pic tall";
    if (r.poster) {
      thumb.classList.add("has-image");
      thumb.style.backgroundImage = "url(" + POSTER_URL + r.poster + ")";
    }
    row.classList.add("with-pic");
    row.appendChild(thumb);
  }
  var del = document.createElement("button");        // delete this review
  del.className = "btn small";
  del.textContent = "✕";
  del.title = "Delete review";
  del.onclick = function () {
    if (!confirm("Delete this review?")) { return; }
    cloudDeleteReview(r.id);
    saveList("filmlify_reviews", getList("filmlify_reviews").filter(function (x) { return x.id !== r.id; }));
    renderProfile();
    if (current) { paintReviews(); }
  };
  row.appendChild(inner);
  row.appendChild(del);
  return row;
}

// Fill the Profile page (reviews + watchlist)
function renderProfile() {
  updateStats();       // the numbers at the top of the Profile
  renderGenres();      // the Favorite Genre bars
  ensureReviewIds();   // older reviews get an id so they can be deleted
  renderCustomLists();
  renderFavorites();   // your favorite films and shows
  var reviewBox = document.getElementById("reviewList");
  reviewBox.replaceChildren();
  var reviews = getList("filmlify_reviews").slice().reverse();      // newest first
  if (reviews.length === 0) { reviewBox.textContent = "No reviews yet. Click any poster to write one."; }
  reviews.forEach(function (r) { reviewBox.appendChild(reviewElement(r, true)); });

  renderCollections();     // Watchlist and Watched sections
}

function paintStars() {
  document.querySelectorAll(".star-btn").forEach(function (b) {
    b.classList.toggle("on", Number(b.dataset.value) <= chosenStars);
  });
}

function paintReviews() {
  if (CLOUD) { paintCommunityReviews(); return; }     // online: show everybody's reviews with usernames
  var box = document.getElementById("mReviews");
  box.replaceChildren();
  var key = current.media_type + "-" + current.id;
  var mine = getList("filmlify_reviews").filter(function (r) { return r.key === key; }).reverse();
  if (mine.length === 0) { box.textContent = "No reviews yet. Be the first!"; }
  mine.forEach(function (r) { box.appendChild(reviewElement(r, false)); });
}

function paintWatchlistButton() {
  if (!current) { return; }
  var key = current.media_type + "-" + current.id;
  var inList = getList("filmlify_watchlist").some(function (w) { return w.key === key; });
  document.getElementById("mWatchlist").textContent = inList ? "✓ In Watchlist (click to remove)" : "+ Add to Watchlist";
  document.getElementById("mWatchlist").classList.toggle("is-on", inList);
}

function toggleWatchlist(m) {
  if (!requireLogin("use your watchlist")) { return; }
  var key = m.media_type + "-" + m.id;
  var list = getList("filmlify_watchlist");
  var exists = list.some(function (w) { return w.key === key; });
  if (exists) {
    list = list.filter(function (w) { return w.key !== key; });
    showMessage("Removed from your watchlist.");
  } else {
    list.push(Object.assign({}, slim(m), { key: key, title: nameOf(m), year: yearOf(m) }));
    showMessage("Added to your watchlist!");
  }
  saveList("filmlify_watchlist", list);
  if (exists) { cloudListRemove("watchlist", key); } else { cloudListAdd("watchlist", m); }
  renderProfile();
  paintWatchlistButton();
}

// Open the pop-up for a movie/show
function openMovie(m) {
  remember(m);
  current = m;
  var mine = getList("filmlify_reviews").find(function (r) { return r.key === m.media_type + "-" + m.id; });
  chosenStars = mine ? mine.stars : 0;               // your old review (if any) is loaded so you can edit it
  document.getElementById("mTitle").textContent = nameOf(m);
  document.getElementById("mMeta").textContent =
    (m.media_type === "tv" ? "TV Show" : "Movie") + (yearOf(m) ? " • " + yearOf(m) : "") +
    (m.vote_average ? " • ★ " + m.vote_average.toFixed(1) : "");
  document.getElementById("mOverview").textContent = m.overview || "No description available.";
  document.getElementById("mPoster").style.backgroundImage = m.poster_path ? "url(" + POSTER_URL + m.poster_path + ")" : "none";
  document.getElementById("reviewText").value = mine ? mine.text : "";
  document.getElementById("reviewError").textContent = "";
  paintStars();
  paintReviews();
  paintWatchlistButton();
  paintWatchedButton();
  paintFavoriteButton();
  paintListSelect();
  loadDetails(m);
  document.getElementById("modal").classList.add("open");
}
function closeMovie() { document.getElementById("modal").classList.remove("open"); }

// Click a poster -> open its pop-up
document.addEventListener("click", async function (e) {
  var card = e.target.closest(".card");
  if (!card || e.target.closest(".quick")) { return; }
  if (!card.dataset.key) {                       // a card typed by hand: look it up first
    var found = await searchTMDB(card.querySelector("b").textContent);
    if (!found) { showMessage("Sorry, no details found for this title."); return; }
    card.dataset.key = remember(found);
  }
  openMovie(known[card.dataset.key]);
});

// Banner buttons: "More Info" opens the pop-up, "Add to List" adds to the watchlist
document.querySelectorAll(".hero[data-title], .spotlight[data-title]").forEach(function (hero) {
  hero.querySelectorAll(".btn").forEach(function (button) {
    button.onclick = async function () {
      var found = await searchTMDB(hero.dataset.title);
      if (!found) { showMessage("Sorry, no details found for this title."); return; }
      remember(found);
      if (button.classList.contains("add")) { toggleWatchlist(found); } else { openMovie(found); }
    };
  });
});

// Pop-up buttons
document.querySelectorAll(".star-btn").forEach(function (b) {
  b.onclick = function () {
    if (!requireLogin("write a review")) { return; }
    chosenStars = Number(b.dataset.value);
    paintStars();
  };
});
document.getElementById("mWatchlist").onclick = function () { toggleWatchlist(current); };
document.getElementById("closeModal").onclick = closeMovie;
document.getElementById("modal").onclick = function (e) { if (e.target === this) { closeMovie(); } };

// The single "Done" button: saves (or updates) your review and closes the pop-up
document.getElementById("postReview").onclick = function () {
  var text = document.getElementById("reviewText").value.trim();

  if (chosenStars === 0 && text === "") { closeMovie(); return; }     // nothing to save, just close
  if (chosenStars === 0) {
    document.getElementById("reviewError").textContent = "Please pick a star rating first.";
    return;
  }
  if (!requireLogin("post a review")) { return; }

  var key = current.media_type + "-" + current.id;
  var reviews = getList("filmlify_reviews");
  var review = reviews.find(function (r) { return r.key === key; });       // one review per movie
  var date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  var updated = !!review;
  if (review) {
    review.stars = chosenStars; review.text = text; review.date = date;
    review.poster = current.poster_path || ""; review.genres = genreNames(current);
  } else {
    review = { id: Date.now(), key: key, title: nameOf(current), poster: current.poster_path || "",
               genres: genreNames(current), stars: chosenStars, text: text, date: date };
    reviews.push(review);
  }
  saveList("filmlify_reviews", reviews);
  cloudSaveReview(review);                  // also share it online (if the database is connected)
  addWatched(current);                      // reviewing a movie counts it as watched
  renderProfile();
  closeMovie();
  showMessage(updated ? "Review updated!" : "Review saved! You can see it on your Profile.");
};
renderProfile();

/* ============ 10. SEARCH DROP-DOWN LIST ============ */
// Type in the search box and a list of matching movies/shows appears underneath.
var searchBox = document.getElementById("search");
var suggestionBox = document.getElementById("suggestions");
var searchTimer = null;
var suggestions = [];        // the movies/shows shown in the list
var activeRow = -1;          // which row is highlighted with the arrow keys

function hideSuggestions() {
  suggestionBox.classList.remove("open");
  suggestions = [];
  activeRow = -1;
}

function showSuggestions() {
  suggestionBox.replaceChildren();
  if (suggestions.length === 0) {
    var none = document.createElement("div");
    none.className = "no-result";
    none.textContent = "No movies or shows found.";
    suggestionBox.appendChild(none);
  }
  suggestions.forEach(function (m, index) {
    var row = document.createElement("div");
    row.className = "suggestion" + (index === activeRow ? " active" : "");

    var thumb = document.createElement("div");
    thumb.className = "thumb";
    if (m.poster_path) { thumb.style.backgroundImage = "url(https://image.tmdb.org/t/p/w92" + m.poster_path + ")"; }

    var text = document.createElement("div");
    var name = document.createElement("b");
    name.textContent = nameOf(m);
    var info = document.createElement("small");
    info.textContent = (m.media_type === "tv" ? "TV Show" : "Movie") + (yearOf(m) ? " • " + yearOf(m) : "");
    text.appendChild(name);
    text.appendChild(document.createElement("br"));
    text.appendChild(info);

    row.appendChild(thumb);
    row.appendChild(text);
    row.onclick = function () { chooseSuggestion(m); };
    suggestionBox.appendChild(row);
  });
  suggestionBox.classList.add("open");
}

function chooseSuggestion(m) {
  hideSuggestions();
  searchBox.value = "";
  openMovie(m);
}

async function runSearch(text) {
  try {
    var response = await fetch(TMDB_URL + "/search/multi?query=" + encodeURIComponent(text) + "&api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    if (searchBox.value.trim() !== text) { return; }      // the person kept typing: ignore this old answer
    suggestions = (data.results || []).filter(function (m) {
      return m.media_type === "movie" || m.media_type === "tv";
    }).slice(0, 6);
    activeRow = -1;
    showSuggestions();
  } catch (error) {
    console.error("Search failed:", error);
  }
}

searchBox.addEventListener("input", function () {
  clearTimeout(searchTimer);
  var text = searchBox.value.trim();
  if (text.length < 2) { hideSuggestions(); return; }
  searchTimer = setTimeout(function () { runSearch(text); }, 300);   // wait until typing pauses
});

searchBox.addEventListener("keydown", function (e) {
  if (e.key === "ArrowDown" && suggestions.length) { activeRow = (activeRow + 1) % suggestions.length; showSuggestions(); e.preventDefault(); }
  else if (e.key === "ArrowUp" && suggestions.length) { activeRow = (activeRow - 1 + suggestions.length) % suggestions.length; showSuggestions(); e.preventDefault(); }
  else if (e.key === "Enter" && suggestions.length) { chooseSuggestion(suggestions[activeRow >= 0 ? activeRow : 0]); }
});

document.addEventListener("click", function (e) {            // click anywhere else closes the list
  if (!e.target.closest(".search-wrap")) { hideSuggestions(); }
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    hideSuggestions();
    var isOpen = function (id) { return document.getElementById(id).classList.contains("open"); };
    if (isOpen("modal")) { closeMovie(); }
    else if (isOpen("listModal")) { closeListModal(); }
    else if (isOpen("peopleModal")) { closePeopleModal(); }
    else if (isOpen("editModal")) { closeEditModal(); }
  }
});


/* ============ 11. IMAGE ICONS: PEOPLE, NEWS, SPOTLIGHT, DIRECTORS ============ */
var personCache = {};

// Look up a person (actor, director...) and return the best match that has a photo
async function searchPerson(name) {
  if (name in personCache) { return personCache[name]; }
  try {
    var response = await fetch(TMDB_URL + "/search/person?query=" + encodeURIComponent(name) + "&api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    personCache[name] = (data.results || []).find(function (p) { return p.profile_path; }) || null;
    return personCache[name];
  } catch (error) {
    console.error("Person lookup failed for '" + name + "':", error);
    return null;
  }
}

// Every <div class="pic" data-title="..."> gets a poster, every data-person="..." gets a photo
async function loadIcons() {
  var icons = Array.from(document.querySelectorAll(".pic[data-title], .pic[data-person]"));
  await Promise.all(icons.map(async function (icon) {
    var url = "";
    if (icon.dataset.person) {
      var person = await searchPerson(icon.dataset.person);
      if (person) { url = PROFILE_URL + person.profile_path; }
    } else {
      var item = await searchTMDB(icon.dataset.title);
      if (item) { url = POSTER_URL + item.poster_path; }
    }
    if (url) {
      icon.style.backgroundImage = "url(" + url + ")";
      icon.classList.add("has-image");
    }
  }));
}

// Trending People: replace the typed names with this week's trending people from TMDB
async function fillPeople() {
  var row = document.getElementById("peopleRow");
  try {
    var response = await fetch(TMDB_URL + "/trending/person/week?api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    var people = (data.results || []).filter(function (p) { return p.profile_path; }).slice(0, 12);
    if (people.length === 0) { return; }
    row.replaceChildren();
    people.forEach(function (p) {
      var box = document.createElement("div");
      box.className = "person";
      var pic = document.createElement("div");
      pic.className = "pic round has-image";
      pic.style.backgroundImage = "url(" + PROFILE_URL + p.profile_path + ")";
      var name = document.createElement("div");
      name.textContent = p.name;
      var follow = document.createElement("button");
      follow.className = "btn small follow-btn";
      follow.dataset.name = p.name;
      box.appendChild(pic);
      box.appendChild(name);
      box.appendChild(follow);
      row.appendChild(box);
    });
    row.scrollLeft = 0;
    paintFollowButtons();
  } catch (error) {
    console.error("Could not load trending people:", error);
  }
}


/* ============ 12. PROFILE NUMBERS, WATCHED, FOLLOW AND FAVORITE GENRES ============ */
// TMDB sends genres as numbers. This list turns them into names.
var GENRE_NAMES = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary",
  18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie", 53: "Thriller",
  10752: "War", 37: "Western", 10759: "Action", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi", 10766: "Soap", 10767: "Talk", 10768: "War"
};
function genreNames(m) {
  return (m.genre_ids || []).map(function (id) { return GENRE_NAMES[id]; }).filter(Boolean);
}

// The five numbers at the top of the Profile. They start at 0 and grow as you use the site.
function updateStats() {
  var cc = window.cloudCounts || { followers: 0, following: 0 };
  document.getElementById("statFollowers").textContent = cc.followers;      // real followers come from the database
  document.getElementById("statFollowing").textContent = cc.following + getList("filmlify_following").length;   // people + stars you follow
  document.getElementById("statWatched").textContent = getList("filmlify_watched").length;
  document.getElementById("statReviews").textContent = getList("filmlify_reviews").length;
  document.getElementById("statWatchlist").textContent = getList("filmlify_watchlist").length;
}

// Favorite Genre: the percentages come from the genres of the movies/shows you reviewed
function renderGenres() {
  var box = document.getElementById("genreBars");
  box.replaceChildren();
  var counts = {}, total = 0;
  getList("filmlify_reviews").forEach(function (r) {
    (r.genres || []).forEach(function (g) { counts[g] = (counts[g] || 0) + 1; total++; });
  });
  var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 4);
  if (top.length === 0) { box.textContent = "Review a movie or show and its genres will appear here."; return; }

  top.forEach(function (g) {
    var percent = Math.round(counts[g] / total * 100);
    var label = document.createElement("div");
    label.style.display = "flex";
    label.style.justifyContent = "space-between";
    label.innerHTML = "<span></span><b></b>";
    label.firstChild.textContent = g;
    label.lastChild.textContent = percent + "%";
    var bar = document.createElement("div");
    bar.className = "bar";
    var fill = document.createElement("i");
    fill.style.width = percent + "%";
    bar.appendChild(fill);
    box.appendChild(label);
    box.appendChild(bar);
  });
}

// Watched list
function addWatched(m) {
  var key = m.media_type + "-" + m.id;
  var list = getList("filmlify_watched");
  if (!list.some(function (w) { return w.key === key; })) {
    list.push(Object.assign({}, slim(m), { key: key, title: nameOf(m) }));
    saveList("filmlify_watched", list);
    cloudListAdd("watched", m);
  }
}
function toggleWatched(m) {
  if (!requireLogin("mark movies as watched")) { return; }
  var key = m.media_type + "-" + m.id;
  var list = getList("filmlify_watched");
  if (list.some(function (w) { return w.key === key; })) {
    saveList("filmlify_watched", list.filter(function (w) { return w.key !== key; }));
    cloudListRemove("watched", key);
    showMessage("Removed from your watched list.");
  } else {
    addWatched(m);
    showMessage("Marked as watched!");
  }
  paintWatchedButton();
  renderProfile();
}
function paintWatchedButton() {
  if (!current) { return; }
  var key = current.media_type + "-" + current.id;
  var done = getList("filmlify_watched").some(function (w) { return w.key === key; });
  document.getElementById("mWatched").textContent = done ? "✓ Watched (click to undo)" : "Mark as Watched";
  document.getElementById("mWatched").classList.toggle("is-on", done);
}
document.getElementById("mWatched").onclick = function () { toggleWatched(current); };

// Follow buttons (next to Trending People and Popular Directors)
function paintFollowButtons() {
  var following = getList("filmlify_following");
  document.querySelectorAll(".follow-btn").forEach(function (b) {
    b.textContent = following.indexOf(b.dataset.name) >= 0 ? "Following ✓" : "Follow";
  });
}
document.addEventListener("click", function (e) {
  var button = e.target.closest(".follow-btn");
  if (!button) { return; }
  if (!requireLogin("follow people")) { return; }
  var name = button.dataset.name;
  var following = getList("filmlify_following");
  if (following.indexOf(name) >= 0) {
    following = following.filter(function (n) { return n !== name; });
    showMessage("You unfollowed " + name + ".");
  } else {
    following.push(name);
    showMessage("You are now following " + name + "!");
  }
  saveList("filmlify_following", following);
  paintFollowButtons();
  renderProfile();
});
paintFollowButtons();
renderProfile();


/* ============ 13. FIX OLD REVIEWS: ADD THEIR POSTER AND GENRES ============ */
// Reviews saved before posters/genres were stored have neither. This asks TMDB for them
// once, saves them, and the Profile then shows the movie image in Recent Reviews.
async function fillMissingReviewData() {
  var reviews = getList("filmlify_reviews");
  var changed = false;

  for (var i = 0; i < reviews.length; i++) {
    var r = reviews[i];
    if (!r.key || (r.poster !== undefined && r.genres !== undefined)) { continue; }   // already complete

    var parts = r.key.split("-");                        // "movie-550" -> ["movie", "550"]
    try {
      var response = await fetch(TMDB_URL + "/" + parts[0] + "/" + parts[1] + "?api_key=" + TMDB_KEY);
      if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
      var data = await response.json();
      r.poster = data.poster_path || "";
      r.genres = (data.genres || []).map(function (g) { return GENRE_NAMES[g.id] || g.name; });
      changed = true;
    } catch (error) {
      console.error("Could not fetch details for review '" + r.title + "':", error);
    }
  }

  if (changed) {
    saveList("filmlify_reviews", reviews);
    renderProfile();
  }
}
fillMissingReviewData();


/* ============ 14. NEW EPISODES THIS WEEK (follows what is trending) ============ */
// Returns the show's newest episode if it airs within a week of today, otherwise null
function episodeThisWeek(details) {
  var DAY = 24 * 60 * 60 * 1000, now = Date.now();
  var next = details.next_episode_to_air, last = details.last_episode_to_air;
  if (next && next.air_date) {
    var t = new Date(next.air_date + "T00:00").getTime();
    if (t >= now - DAY && t <= now + 7 * DAY) { return next; }       // coming up this week
  }
  if (last && last.air_date) {
    var t2 = new Date(last.air_date + "T00:00").getTime();
    if (t2 >= now - 7 * DAY && t2 <= now + DAY) { return last; }     // aired in the last 7 days
  }
  return null;
}

function dayLabel(dateText) {
  var date = new Date(dateText + "T00:00");
  if (date.toDateString() === new Date().toDateString()) { return "Today"; }
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

async function fillEpisodes() {
  var list = document.getElementById("episodeList");
  try {
    var response = await fetch(TMDB_URL + "/trending/tv/week?api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    var shows = (data.results || []).slice(0, 18);          // look at the 18 most trending shows

    // ask TMDB for each show's newest episode
    var found = await Promise.all(shows.map(async function (show) {
      var r = await fetch(TMDB_URL + "/tv/" + show.id + "?api_key=" + TMDB_KEY);
      if (!r.ok) { return null; }
      var episode = episodeThisWeek(await r.json());
      return episode ? { show: show, episode: episode } : null;
    }));
    found = found.filter(Boolean).slice(0, 10);
    if (found.length === 0) { return; }                     // keep the typed rows

    list.replaceChildren();
    found.forEach(function (f) {
      var row = document.createElement("div");
      row.className = "item with-pic";
      row.dataset.key = remember(f.show);                    // clicking the row opens the show's pop-up

      var pic = document.createElement("div");
      pic.className = "pic tall";
      if (f.show.poster_path) {
        pic.classList.add("has-image");
        pic.style.backgroundImage = "url(" + POSTER_URL + f.show.poster_path + ")";
      }

      var text = document.createElement("span");
      var title = document.createElement("b");
      title.textContent = f.show.name;
      var info = document.createElement("small");
      info.textContent = "S" + f.episode.season_number + " E" + f.episode.episode_number + " • " + f.episode.name;
      text.appendChild(title);
      text.appendChild(document.createElement("br"));
      text.appendChild(info);

      var day = document.createElement("small");
      day.className = "day";
      day.textContent = "📅 " + dayLabel(f.episode.air_date);

      row.appendChild(pic);
      row.appendChild(text);
      row.appendChild(day);
      list.appendChild(row);
    });
  } catch (error) {
    console.error("Could not load new episodes:", error);
  }
}

// Click an episode row -> open that show's pop-up
document.addEventListener("click", function (e) {
  var row = e.target.closest(".item[data-key]");
  if (row && known[row.dataset.key]) { openMovie(known[row.dataset.key]); }
});


/* ============ 15. CLICKABLE GENRE CARDS ============ */
// TMDB's number for each TV genre. (TMDB has no "Thriller" TV genre, so it shows Crime + Mystery shows.)
var TV_GENRE_IDS = {
  "Drama": "18", "Sci-Fi": "10765", "Crime": "80", "Animation": "16",
  "Thriller": "80,9648", "Comedy": "35", "Mystery": "9648", "Documentary": "99"
};
var genreClicks = 0;     // lets us ignore old answers if you click several genres quickly

async function showGenre(card) {
  var name = card.textContent.trim();
  var myClick = ++genreClicks;

  document.querySelectorAll(".genres div").forEach(function (c) { c.classList.toggle("active", c === card); });
  var section = document.getElementById("genreResults");
  var row = document.getElementById("genreRow");
  document.getElementById("genreTitle").textContent = name + " TV Shows";
  section.hidden = false;
  row.replaceChildren(spinner());

  try {
    var url = TMDB_URL + "/discover/tv?with_genres=" + encodeURIComponent(TV_GENRE_IDS[name]) +
              "&sort_by=popularity.desc&api_key=" + TMDB_KEY;
    var response = await fetch(url);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    if (myClick !== genreClicks) { return; }                 // another genre was clicked meanwhile

    var items = (data.results || []).filter(function (m) { return m.poster_path; });
    row.replaceChildren();
    if (items.length === 0) { row.textContent = "No shows found for this genre."; }
    items.forEach(function (m) { row.appendChild(makeCard(m)); });   // clicking a poster opens its pop-up
    row.scrollLeft = 0;
  } catch (error) {
    row.textContent = "Could not load shows. Check your internet connection.";
    console.error("Genre lookup failed:", error);
  }
  updateAllArrows();
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelectorAll(".genres div").forEach(function (card) {
  card.onclick = function () { showGenre(card); };
  card.onkeydown = function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showGenre(card); }
  };
});


/* ============ 16. RICHER POP-UP: CAST, TRAILER, WHERE TO WATCH, SIMILAR ============ */
function addFact(box, label, text) {
  if (!text) { return; }
  var p = document.createElement("p");
  var b = document.createElement("b");
  b.textContent = label + ": ";
  p.appendChild(b);
  p.appendChild(document.createTextNode(text));
  box.appendChild(p);
}

async function loadDetails(m) {
  var extra = document.getElementById("mExtra");
  var similar = document.getElementById("mSimilar");
  extra.replaceChildren(spinner());
  similar.replaceChildren();
  try {
    var url = TMDB_URL + "/" + m.media_type + "/" + m.id +
              "?append_to_response=credits,videos,watch/providers,similar&api_key=" + TMDB_KEY;
    var response = await fetch(url);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var d = await response.json();
    if (!current || current.id !== m.id) { return; }          // a different pop-up is open now
    if (!m.overview && d.overview) { m.overview = d.overview; document.getElementById("mOverview").textContent = d.overview; }
    extra.replaceChildren();

    var minutes = d.runtime ? d.runtime + " min" : (d.episode_run_time && d.episode_run_time[0] ? d.episode_run_time[0] + " min per episode" : "");
    var genres = (d.genres || []).map(function (g) { return g.name; }).join(", ");
    addFact(extra, "Details", [minutes, genres].filter(Boolean).join(" • "));
    addFact(extra, "Cast", ((d.credits || {}).cast || []).slice(0, 6).map(function (c) { return c.name; }).join(", "));

    var regions = (d["watch/providers"] || {}).results || {};
    var region = regions.PH || regions.US;                    // Philippines first, then USA
    var where = region && region.flatrate ? region.flatrate.map(function (p) { return p.provider_name; }).join(", ") : "";
    addFact(extra, "Where to watch", where || "not listed for your region");

    var trailer = ((d.videos || {}).results || []).find(function (v) { return v.site === "YouTube" && v.type === "Trailer"; });
    if (trailer) {
      var link = document.createElement("a");
      link.className = "btn";
      link.textContent = "▶ Watch Trailer";
      link.href = "https://www.youtube.com/watch?v=" + trailer.key;
      link.target = "_blank";
      link.rel = "noopener";
      extra.appendChild(link);
    }

    ((d.similar || {}).results || []).filter(function (x) { return x.poster_path; }).slice(0, 10).forEach(function (x) {
      x.media_type = m.media_type;
      similar.appendChild(makeCard(x));                       // click one to open it
    });
    updateAllArrows();
  } catch (error) {
    extra.textContent = "";
    console.error("Could not load details:", error);
  }
}

/* ============ 17. HOVER QUICK ACTIONS (♥ ✓ +) ============ */
document.addEventListener("click", function (e) {
  var button = e.target.closest(".quick button");
  if (!button) { return; }
  var m = known[button.closest(".card").dataset.key];
  if (!m) { return; }
  if (button.dataset.action === "watchlist") { toggleWatchlist(m); }
  else if (button.dataset.action === "watched") { toggleWatched(m); }
  else {
    if (!requireLogin("like movies")) { return; }
    var key = m.media_type + "-" + m.id;
    var liked = getList("filmlify_liked");
    if (liked.indexOf(key) >= 0) { liked = liked.filter(function (k) { return k !== key; }); showMessage("Removed your like."); }
    else { liked.push(key); showMessage("You liked " + nameOf(m) + "!"); }
    saveList("filmlify_liked", liked);
    button.classList.toggle("liked", liked.indexOf(key) >= 0);
  }
});

/* ============ 18. DELETE REVIEWS, CUSTOM LISTS, EDIT PROFILE ============ */
function ensureReviewIds() {
  var reviews = getList("filmlify_reviews"), fixed = false;
  reviews.forEach(function (r, i) { if (!r.id) { r.id = Date.now() + i; fixed = true; } });
  if (fixed) { saveList("filmlify_reviews", reviews); }
}

function renderCustomLists() {
  var box = document.getElementById("customLists");
  box.replaceChildren();
  var lists = getList("filmlify_customlists");
  if (lists.length === 0) { box.textContent = "No lists yet. Create one below."; }
  lists.forEach(function (l) {
    var row = document.createElement("div");
    row.className = "item";
    var info = document.createElement("span");
    var name = document.createElement("b");
    name.textContent = l.name + " (" + l.items.length + ")";
    info.appendChild(name);
    if (l.items.length) {
      var titles = document.createElement("small");
      titles.textContent = l.items.map(function (i) { return i.title; }).join(", ");
      info.appendChild(document.createElement("br"));
      info.appendChild(titles);
    }
    var del = document.createElement("button");
    del.className = "btn small";
    del.textContent = "✕";
    del.title = "Delete list";
    del.onclick = function () {
      saveList("filmlify_customlists", getList("filmlify_customlists").filter(function (x) { return x.id !== l.id; }));
      renderCustomLists();
      paintListSelect();
    };
    row.appendChild(info);
    row.appendChild(del);
    box.appendChild(row);
  });
}

function paintListSelect() {
  var select = document.getElementById("mListSelect");
  select.replaceChildren();
  var lists = getList("filmlify_customlists");
  if (lists.length === 0) { select.appendChild(new Option("Create a list on your Profile first", "")); }
  lists.forEach(function (l) { select.appendChild(new Option(l.name, l.id)); });
}

document.getElementById("createList").onclick = function () {
  if (!requireLogin("create lists")) { return; }
  var input = document.getElementById("newListName");
  var name = input.value.trim();
  if (!name) { showMessage("Type a name for your list first."); return; }
  var lists = getList("filmlify_customlists");
  lists.push({ id: Date.now(), name: name, items: [] });
  saveList("filmlify_customlists", lists);
  input.value = "";
  renderCustomLists();
  showMessage("List created!");
};

document.getElementById("mListAdd").onclick = function () {
  if (!requireLogin("use your lists")) { return; }
  var id = document.getElementById("mListSelect").value;
  if (!id || !current) { showMessage("Create a list on your Profile page first."); return; }
  var lists = getList("filmlify_customlists");
  var list = lists.find(function (l) { return String(l.id) === id; });
  var key = current.media_type + "-" + current.id;
  if (list.items.some(function (i) { return i.key === key; })) { showMessage("Already in " + list.name + "."); return; }
  list.items.push({ key: key, title: nameOf(current) });
  saveList("filmlify_customlists", lists);
  renderCustomLists();
  showMessage("Added to " + list.name + "!");
};

// Edit Profile (a pop-up form; your answers are saved in this browser and in the database)
var me = currentUser();
var profileInfo = {
  name: me ? (me.displayName || me.username) : "Guest",
  bio: me ? (me.bio || "Film lover") : "",
  avatar: ""
};
try { profileInfo = JSON.parse(localStorage.getItem(userKey("filmlify_profile"))) || profileInfo; } catch (e) {}
function paintProfileInfo() {
  var u = currentUser();
  var handle = u ? "@" + u.username : "";
  document.getElementById("pName").textContent = profileInfo.name;
  document.getElementById("pBio").textContent = profileInfo.bio ? handle + " • " + profileInfo.bio : handle;
  paintAvatar(document.getElementById("pAvatar"), profileInfo.avatar, profileInfo.name);
}
paintProfileInfo();
renderProfile();

/* ============ 19. BROWSE PAGE WITH FILTERS ============ */
var MOVIE_GENRES = [[28, "Action"], [12, "Adventure"], [16, "Animation"], [35, "Comedy"], [80, "Crime"], [99, "Documentary"], [18, "Drama"], [14, "Fantasy"], [27, "Horror"], [9648, "Mystery"], [10749, "Romance"], [878, "Sci-Fi"], [53, "Thriller"]];
var TV_GENRES_LIST = [[10759, "Action & Adventure"], [16, "Animation"], [35, "Comedy"], [80, "Crime"], [99, "Documentary"], [18, "Drama"], [9648, "Mystery"], [10765, "Sci-Fi & Fantasy"]];
var browsePage = 1;
var fType = document.getElementById("fType"), fGenre = document.getElementById("fGenre"), fYear = document.getElementById("fYear");
var fRating = document.getElementById("fRating"), fSort = document.getElementById("fSort");
var browseGrid = document.getElementById("browseGrid"), loadMore = document.getElementById("loadMore");

function fillGenreFilter() {
  fGenre.replaceChildren(new Option("Any genre", ""));
  (fType.value === "movie" ? MOVIE_GENRES : TV_GENRES_LIST).forEach(function (g) { fGenre.appendChild(new Option(g[1], g[0])); });
}
fYear.appendChild(new Option("Any year", ""));
for (var year = 2026; year >= 1970; year--) { fYear.appendChild(new Option(year, year)); }

async function runBrowse(more) {
  if (more) { browsePage++; } else { browsePage = 1; browseGrid.replaceChildren(spinner()); }
  var type = fType.value;
  var sort = fSort.value;
  if (type === "tv" && sort === "primary_release_date.desc") { sort = "first_air_date.desc"; }
  var params = ["sort_by=" + sort, "page=" + browsePage, "vote_count.gte=100"];
  if (fGenre.value) { params.push("with_genres=" + fGenre.value); }
  if (fYear.value) { params.push((type === "movie" ? "primary_release_year=" : "first_air_date_year=") + fYear.value); }
  if (fRating.value) { params.push("vote_average.gte=" + fRating.value); }
  try {
    var response = await fetch(TMDB_URL + "/discover/" + type + "?" + params.join("&") + "&api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    if (!more) { browseGrid.replaceChildren(); }
    var items = (data.results || []).filter(function (m) { return m.poster_path; });
    if (!more && items.length === 0) { browseGrid.textContent = "No results. Try different filters."; }
    items.forEach(function (m) { m.media_type = type; browseGrid.appendChild(makeCard(m)); });
    loadMore.hidden = browsePage >= data.total_pages;
  } catch (error) {
    browseGrid.textContent = "Could not load results. Check your internet connection.";
    console.error("Browse failed:", error);
  }
}
fType.onchange = function () { fillGenreFilter(); runBrowse(false); };
[fGenre, fYear, fRating, fSort].forEach(function (f) { f.onchange = function () { runBrowse(false); }; });
loadMore.onclick = function () { runBrowse(true); };
fillGenreFilter();
runBrowse(false);

/* ============ 20. PHONE MENU BUTTON ============ */
document.getElementById("menuBtn").onclick = function () { document.getElementById("mainNav").classList.toggle("open"); };
window.addEventListener("hashchange", function () { document.getElementById("mainNav").classList.remove("open"); });


/* ============ 21. LOGIN SYSTEM (accounts are stored in THIS browser only) ============ */
// This is a demo login: accounts live in your browser, not on a server.
// For real security (other devices, password reset...) you need a backend such as Firebase or Supabase.
var returnTo;     // the page to go back to after logging in

function accounts() {
  try { return JSON.parse(localStorage.getItem("filmlify_accounts")) || []; } catch (e) { return []; }
}
function currentUser() {
  if (CLOUD) {                                     // real accounts: the session comes from Supabase
    var cs = cloudSession();
    return cs ? { username: cs.username, id: cs.user_id, displayName: cs.displayName || cs.username, handle: "@" + cs.username, bio: cs.bio || "Film lover" } : null;
  }
  try {
    var name = localStorage.getItem("filmlify_session");
    if (!name) { return null; }
    return accounts().find(function (a) { return a.username === name; }) || null;
  } catch (e) { return null; }
}
function userKey(name) {                         // "filmlify_reviews" -> "filmlify_reviews:brian"
  var u = currentUser();
  return u ? name + ":" + u.username : null;
}

// Scrambles the password so it is not saved as plain text
async function hashPassword(password, salt) {
  var text = salt + ":" + password;
  if (window.crypto && crypto.subtle) {
    var buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buffer)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  var h = 0;                                      // simple backup for old browsers (weaker)
  for (var i = 0; i < text.length; i++) { h = (h * 31 + text.charCodeAt(i)) | 0; }
  return "basic" + h;
}

function finishLogin(username, message) {
  localStorage.setItem("filmlify_session", username);
  sessionStorage.setItem("flash", message);
  sessionStorage.setItem("goto", returnTo || "#home");
  location.reload();                              // reloads so every page shows this user's data
}
function logout() {
  localStorage.removeItem("filmlify_cloud");
  localStorage.removeItem("filmlify_session");
  sessionStorage.setItem("flash", "You are logged out.");
  sessionStorage.setItem("goto", "#home");
  location.reload();
}

// Call this before any action that needs an account. Returns true if the user is logged in.
function requireLogin(what) {
  if (currentUser()) { return true; }
  returnTo = location.hash || "#home";
  showMessage("Please log in to " + what + ".");
  closeMovie();
  location.hash = "#login";
  return false;
}

// Show the person's name and a Log out link in the header
function paintUserArea() {
  var area = document.getElementById("userArea");
  var u = currentUser();
  if (!u) { return; }                             // the "Login / Sign up" link is already there
  area.replaceChildren();
  var name = document.createElement("a");
  name.className = "login-link";
  name.href = "#profile";
  name.textContent = u.username;
  var out = document.createElement("a");
  out.className = "login-link";
  out.href = "#";
  out.style.marginLeft = "14px";
  out.textContent = "Log out";
  out.onclick = function (e) { e.preventDefault(); logout(); };
  area.appendChild(name);
  area.appendChild(out);
}
paintUserArea();

// Writing in the review box also needs a login
document.getElementById("reviewText").onfocus = function () {
  if (!currentUser()) { this.blur(); requireLogin("write a review"); }
};

// Message left over from logging in/out
try {
  var flash = sessionStorage.getItem("flash");
  if (flash) { sessionStorage.removeItem("flash"); showMessage(flash); }
} catch (e) {}


/* ============ 22. FAVORITES (EACH USER PICKS THEIR OWN) AND LOGIN-PAGE POSTERS ============ */
// Keep only what we need to show a movie again later
function slim(m) {
  return { id: m.id, media_type: m.media_type, title: m.title, name: m.name, poster_path: m.poster_path,
           overview: m.overview, vote_average: m.vote_average, release_date: m.release_date,
           first_air_date: m.first_air_date, genre_ids: m.genre_ids };
}

function fillFavorites(rowId, type) {
  var row = document.getElementById(rowId);
  row.replaceChildren();
  var favs = getList("filmlify_favorites").filter(function (f) { return f.media_type === type && f.poster_path; }).slice(0, 5);
  favs.forEach(function (m) { row.appendChild(makeCard(m)); });          // click one to open it

  for (var i = favs.length; i < 5; i++) {                                // empty "+" slots
    var slot = document.createElement("div");
    slot.className = "slot";
    var box = document.createElement("div");
    box.className = "slot-poster";
    box.textContent = "+";
    box.onclick = function () {
      showMessage("Search for a title, open it, then press Add to Favorites.");
      document.getElementById("search").focus();
    };
    slot.appendChild(box);
    row.appendChild(slot);
  }
  if (row.updateArrows) { row.updateArrows(); }
}
function renderFavorites() {
  fillFavorites("favFilms", "movie");
  fillFavorites("favShows", "tv");
}

function paintFavoriteButton() {
  if (!current) { return; }
  var key = current.media_type + "-" + current.id;
  var yes = getList("filmlify_favorites").some(function (f) { return f.media_type + "-" + f.id === key; });
  document.getElementById("mFavorite").textContent = yes ? "♥ In Favorites (click to remove)" : "♡ Add to Favorites";
  document.getElementById("mFavorite").classList.toggle("is-on", yes);
}

document.getElementById("mFavorite").onclick = function () {
  if (!requireLogin("save favorites")) { return; }
  var key = current.media_type + "-" + current.id;
  var favs = getList("filmlify_favorites");
  var exists = favs.some(function (f) { return f.media_type + "-" + f.id === key; });
  if (exists) {
    favs = favs.filter(function (f) { return f.media_type + "-" + f.id !== key; });
    showMessage("Removed from your favorites.");
  } else {
    var same = favs.filter(function (f) { return f.media_type === current.media_type; }).length;
    if (same >= 5) {
      showMessage("You can pick up to 5 favorite " + (current.media_type === "tv" ? "shows" : "films") + ". Remove one first.");
      return;
    }
    favs.push(slim(current));
    showMessage("Added to your favorites!");
  }
  saveList("filmlify_favorites", favs);
  renderProfile();
  paintFavoriteButton();
};
renderProfile();

// Login page: fill the left side with real movie posters (trending this week)
async function loadBrandPosters() {
  var box = document.getElementById("brandPosters");
  try {
    var response = await fetch(TMDB_URL + "/trending/movie/week?api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    (data.results || []).filter(function (m) { return m.poster_path; }).slice(0, 16).forEach(function (m) {
      var tile = document.createElement("div");
      tile.style.backgroundImage = "url(" + POSTER_URL + m.poster_path + ")";
      box.appendChild(tile);
    });
  } catch (error) {
    console.error("Could not load login-page posters:", error);     // the colored background stays
  }
}
loadBrandPosters();


/* ============ 23. READY-MADE DEMO ACCOUNT ============ */
// Log in with   username: victor123   password: victor456
// To change it, edit the words below. (Anyone who reads this file can see the password,
// so use it only as a demo and never reuse a real password.)
async function seedDemoAccount() {
  if (CLOUD) { return; }                          // real accounts: no built-in demo user
  try {
    if (accounts().some(function (a) { return a.username === "victor123"; })) { return; }   // already created

    var salt = Math.random().toString(36).slice(2);
    var list = accounts();
    list.push({
      username: "victor123",
      email: "victor@filmlify.demo",
      salt: salt,
      hash: await hashPassword("victor456", salt),
      displayName: "Victor Wenbamamahalin",
      handle: "@wembaby",
      bio: "Film Enthusiast & Reviewer"
    });
    localStorage.setItem("filmlify_accounts", JSON.stringify(list));

    // Starting data for this account. The numbers are TMDB ids; posters are fetched automatically.
    var films = [[510, "One Flew Over the Cuckoo's Nest"], [278, "The Shawshank Redemption"], [77, "Memento"], [274, "The Silence of the Lambs"]];
    var shows = [[1396, "Breaking Bad"], [60059, "Better Call Saul"], [1398, "The Sopranos"]];
    var favorites = [], watched = [];
    films.forEach(function (f) {
      favorites.push({ id: f[0], media_type: "movie", title: f[1] });
      watched.push({ key: "movie-" + f[0], title: f[1] });
    });
    shows.forEach(function (s) {
      favorites.push({ id: s[0], media_type: "tv", name: s[1] });
      watched.push({ key: "tv-" + s[0], title: s[1] });
    });
    watched.push({ key: "movie-641", title: "Requiem for a Dream" });

    var put = function (name, data) { localStorage.setItem(name + ":victor123", JSON.stringify(data)); };
    put("filmlify_favorites", favorites);
    put("filmlify_watched", watched);
    put("filmlify_reviews", [{
      id: 1, key: "movie-641", title: "Requiem for a Dream", stars: 5,
      text: "Ang lakas ng dating ng pelikulang ito. Hindi ko makakalimutan.", date: "Aug 29, 2026"
    }]);
  } catch (e) {
    console.error("Could not create the demo account:", e);
  }
}
seedDemoAccount();

// Favorites that only have an id get their poster and details from TMDB
async function fillMissingFavorites() {
  var favs = getList("filmlify_favorites");
  var changed = false;
  for (var i = 0; i < favs.length; i++) {
    var f = favs[i];
    if (f.poster_path !== undefined) { continue; }
    try {
      var response = await fetch(TMDB_URL + "/" + f.media_type + "/" + f.id + "?api_key=" + TMDB_KEY);
      if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
      var d = await response.json();
      f.poster_path = d.poster_path || "";
      f.title = d.title; f.name = d.name; f.overview = d.overview; f.vote_average = d.vote_average;
      f.release_date = d.release_date; f.first_air_date = d.first_air_date;
      f.genre_ids = (d.genres || []).map(function (g) { return g.id; });
      changed = true;
    } catch (error) {
      console.error("Could not load favorite " + f.id + ":", error);
    }
  }
  if (changed) { saveList("filmlify_favorites", favs); renderProfile(); }
}
fillMissingFavorites();


/* ============ 24. ONLINE DATABASE (SUPABASE): ACCOUNTS, FOLLOWING, SHARED REVIEWS ============ */
var cloudCounts = { followers: 0, following: 0 };
var myFollowing = [];      // ids of the people I follow
var myFollowers = [];      // ids of the people who follow me

function cloudSession() {
  try { return JSON.parse(localStorage.getItem("filmlify_cloud")); } catch (e) { return null; }
}

// Asks Supabase for a fresh login token when the old one is about to expire
async function refreshSession(session) {
  try {
    var r = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!r.ok) { return null; }
    var d = await r.json();
    session.access_token = d.access_token;
    session.refresh_token = d.refresh_token;
    session.expires_at = Math.floor(Date.now() / 1000) + (d.expires_in || 3600);
    localStorage.setItem("filmlify_cloud", JSON.stringify(session));
    return session;
  } catch (e) { return null; }
}

// Talks to the database tables.   db("follows?follower=eq.123", "GET")
async function db(path, method, body, extraHeaders) {
  var session = cloudSession();
  if (session && Date.now() / 1000 > session.expires_at - 30) { session = (await refreshSession(session)) || session; }
  var headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (session) { headers.Authorization = "Bearer " + session.access_token; }     // only logged-in users send this
  if (extraHeaders) { Object.assign(headers, extraHeaders); }
  var response = await fetch(SUPABASE_URL + "/rest/v1/" + path, { method: method || "GET", headers: headers, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) { throw new Error("Database error " + response.status + ": " + await response.text()); }
  var text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function authCall(path, body) {
  try {
    var r = await fetch(SUPABASE_URL + "/auth/v1/" + path, {
      method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    var d = await r.json();
    if (!r.ok) { return { error: true, message: d.msg || d.error_description || d.message || "Something went wrong." }; }
    return d;
  } catch (e) { return { error: true, message: "Could not reach the database. Check your internet." }; }
}

// Sign up / sign in with the online database. Returns "" on success, or an error message.
async function cloudAuth(isSignUp, user, email, pass) {
  try {
    var data;
    if (isSignUp) {
      user = user.toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(user)) { return "Username: 3-20 letters, numbers or _ only."; }
      var taken = await db("profiles?username=eq." + encodeURIComponent(user) + "&select=id");
      if (taken.length) { return "That username is already taken."; }
      data = await authCall("signup", { email: email, password: pass, data: { username: user } });
    } else {
      if (!/^\S+@\S+\.\S+$/.test(user)) { return "Enter the email you signed up with."; }
      data = await authCall("token?grant_type=password", { email: user, password: pass });
    }
    if (data.error) { return data.message; }
    if (!data.access_token) { return "Account created! Check your email to confirm it, then sign in."; }

    var rows = await db("profiles?id=eq." + data.user.id + "&select=username,display_name,bio", "GET", null, { Authorization: "Bearer " + data.access_token });
    var profile = rows[0] || { username: user };
    localStorage.setItem("filmlify_cloud", JSON.stringify({
      access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user_id: data.user.id, username: profile.username, displayName: profile.display_name, bio: profile.bio
    }));
    sessionStorage.setItem("flash", (isSignUp ? "Welcome to Filmlify, " : "Welcome back, ") + profile.username + "!");
    sessionStorage.setItem("goto", returnTo || "#home");
    location.reload();
    return "";
  } catch (error) {
    console.error(error);
    return "Something went wrong. Please try again.";
  }
}

// Reviews and profile edits are copied to the database so followers can see them
function cloudSaveReview(r) {
  var u = currentUser();
  if (!CLOUD || !u || !r) { return; }
  db("reviews?on_conflict=user_id,tmdb_key", "POST", { user_id: u.id, local_id: r.id, tmdb_key: r.key, title: r.title, poster: r.poster || "", stars: r.stars, body: r.text || "" }, { Prefer: "resolution=merge-duplicates,return=minimal" })
    .then(loadFriendFeed).catch(function (e) { console.error("Could not share review:", e); });
}
function cloudDeleteReview(localId) {
  var u = currentUser();
  if (!CLOUD || !u) { return; }
  db("reviews?user_id=eq." + u.id + "&local_id=eq." + localId, "DELETE").catch(function (e) { console.error(e); });
}
function cloudUpdateProfile(info) {
  var u = currentUser();
  if (!CLOUD || !u) { return; }
  db("profiles?id=eq." + u.id, "PATCH", { display_name: info.name, bio: info.bio }, { Prefer: "return=minimal" }).catch(function (e) { console.error(e); });
}

// Who I follow / who follows me
async function refreshFollowing() {
  var u = currentUser();
  if (!CLOUD || !u) { return; }
  try {
    var mine = await db("follows?follower=eq." + u.id + "&select=following");
    var theirs = await db("follows?following=eq." + u.id + "&select=follower");
    myFollowing = mine.map(function (r) { return r.following; });
    myFollowers = theirs.map(function (r) { return r.follower; });
    cloudCounts = { following: myFollowing.length, followers: myFollowers.length };
    updateStats();
  } catch (e) { console.error("Could not load follows:", e); }
}

async function toggleFollowUser(id, username) {
  var u = currentUser();
  if (!u) { requireLogin("follow people"); return; }
  try {
    if (myFollowing.indexOf(id) >= 0) {
      await db("follows?follower=eq." + u.id + "&following=eq." + id, "DELETE");
      showMessage("You unfollowed @" + username + ".");
    } else {
      await db("follows", "POST", { follower: u.id, following: id }, { Prefer: "return=minimal" });
      showMessage("You are now following @" + username + "!");
    }
  } catch (e) { console.error(e); showMessage("Could not update. Please try again.", "error"); return; }
  await loadPeople();
  loadFriendFeed();
  if (document.getElementById("peopleModal").classList.contains("open") && reloadPeopleModal) { reloadPeopleModal(); }
  if (location.hash.indexOf("#member/") === 0) { loadMember(decodeURIComponent(location.hash.split("/")[1] || "")); }
}

// One row in a list of people: photo + name (click to open their profile) + Follow button
function personRow(p) {
  var me = currentUser();
  var row = document.createElement("div");
  row.className = "item person-row";
  var main = document.createElement("div");
  main.className = "person-main";
  main.appendChild(miniAvatar(p.avatar_url, p.display_name || p.username));
  var text = document.createElement("span");
  var name = document.createElement("b");
  name.textContent = p.display_name || p.username;
  var handle = document.createElement("small");
  handle.textContent = "@" + p.username;
  text.appendChild(name);
  text.appendChild(document.createElement("br"));
  text.appendChild(handle);
  main.appendChild(text);
  row.appendChild(main);
  if (!me || p.id !== me.id) {
    var button = document.createElement("button");
    button.className = "btn small";
    button.textContent = myFollowing.indexOf(p.id) >= 0 ? "Following ✓" : "Follow";
    button.onclick = function (e) { e.stopPropagation(); toggleFollowUser(p.id, p.username); };
    row.appendChild(button);
  }
  row.onclick = function () { openUserProfile(p.username, p.id); };
  return row;
}
function fillPeopleList(box, people, emptyText) {
  box.replaceChildren();
  if (people.length === 0) { box.textContent = emptyText; }
  people.forEach(function (p) { box.appendChild(personRow(p)); });
}
async function profilesByIds(ids) {
  if (ids.length === 0) { return []; }
  return await db("profiles?id=in.(" + ids.join(",") + ")&select=" + profileCols());
}

async function searchPeople() {
  var box = document.getElementById("peopleResults");
  var text = document.getElementById("peopleSearch").value.trim().toLowerCase();
  if (text.length < 2) { box.textContent = "Type at least 2 letters."; return; }
  try {
    var me = currentUser();
    var found = await db("profiles?username=ilike.*" + encodeURIComponent(text) + "*&limit=10&select=" + profileCols());
    fillPeopleList(box, found.filter(function (p) { return p.id !== me.id; }), "Nobody found with that username.");
  } catch (e) { console.error(e); box.textContent = "Search failed. Please try again."; }
}

async function loadPeople() {
  var note = document.getElementById("peopleNote");
  if (!CLOUD) {
    note.textContent = "The accounts database is not connected yet. Add your Supabase URL and key at the top of script.js.";
    return;
  }
  if (!currentUser()) { return; }
  await refreshFollowing();
  try {
    fillPeopleList(document.getElementById("followingList"), await profilesByIds(myFollowing), "You are not following anyone yet.");
    fillPeopleList(document.getElementById("followersList"), await profilesByIds(myFollowers), "No followers yet.");
    if (document.getElementById("peopleSearch").value.trim().length >= 2) { searchPeople(); }
  } catch (e) { console.error(e); }
}

// Friend Activity: newest reviews from the people I follow
async function loadFriendFeed() {
  var box = document.getElementById("friendFeed");
  if (!CLOUD || !currentUser()) { return; }
  await refreshFollowing();
  try {
    if (myFollowing.length === 0) { box.textContent = "No friend activity yet. Follow people to see their reviews here."; box.className = "empty"; return; }
    var rows = await db("reviews?user_id=in.(" + myFollowing.join(",") + ")&select=*,profiles(username)&order=created_at.desc&limit=8");
    box.className = "";
    box.replaceChildren();
    if (rows.length === 0) { box.textContent = "The people you follow have not written reviews yet."; return; }
    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "item with-pic";
      var pic = document.createElement("div");
      pic.className = "pic tall";
      if (r.poster) { pic.classList.add("has-image"); pic.style.backgroundImage = "url(" + POSTER_URL + r.poster + ")"; }
      var text = document.createElement("span");
      var who = document.createElement("b");
      who.textContent = "@" + (r.profiles ? r.profiles.username : "someone") + " ";
      if (r.profiles) { who.className = "user-link"; who.dataset.user = r.profiles.username; }
      var stars = document.createElement("span");
      stars.className = "star";
      stars.textContent = starText(r.stars);
      text.appendChild(who);
      text.appendChild(document.createTextNode("reviewed " + r.title + " "));
      text.appendChild(stars);
      if (r.body) { text.appendChild(document.createElement("br")); text.appendChild(document.createTextNode(r.body)); }
      var date = document.createElement("small");
      date.textContent = new Date(r.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      text.appendChild(document.createElement("br"));
      text.appendChild(date);
      row.appendChild(pic);
      row.appendChild(text);
      box.appendChild(row);
    });
  } catch (e) { console.error("Could not load friend activity:", e); }
}

var peopleTimer = null;
document.getElementById("peopleSearch").addEventListener("input", function () {
  clearTimeout(peopleTimer);
  peopleTimer = setTimeout(function () { if (CLOUD && currentUser()) { searchPeople(); } }, 300);
});
window.addEventListener("hashchange", function () { if (location.hash === "#people") { loadPeople(); } });
if (location.hash === "#people") { loadPeople(); }

if (CLOUD) {
  document.querySelector('label[for="user"]').textContent = "Email";
  document.getElementById("user").placeholder = "Enter your email";
  refreshFollowing().then(loadFriendFeed);
}


/* ============ 25. LOADING / EMPTY STATES, WATCHLIST + WATCHED SECTIONS, DATABASE SYNC ============ */
function spinner() {
  var s = document.createElement("div");
  s.className = "spinner";
  s.setAttribute("role", "status");
  s.setAttribute("aria-label", "Loading");
  return s;
}

function emptyState(icon, title, text, linkText, linkHref) {
  var box = document.createElement("div");
  box.className = "empty empty-wide";
  var i = document.createElement("div");
  i.className = "empty-icon";
  i.textContent = icon;
  var t = document.createElement("p");
  var b = document.createElement("b");
  b.textContent = title;
  t.appendChild(b);
  var d = document.createElement("p");
  var sm = document.createElement("small");
  sm.textContent = text;
  d.appendChild(sm);
  var link = document.createElement("a");
  link.className = "btn";
  link.href = linkHref || "#browse";
  link.textContent = linkText || "Browse movies";
  box.appendChild(i); box.appendChild(t); box.appendChild(d); box.appendChild(link);
  return box;
}

// One row of poster cards (used for Watchlist and Watched on the Profile)
function fillCardGrid(rowId, countId, listName, icon, title, text, removeFn) {
  var row = document.getElementById(rowId);
  var list = getList(listName);
  row.replaceChildren();
  document.getElementById(countId).textContent = list.length ? "(" + list.length + ")" : "";
  if (list.length === 0) { row.appendChild(emptyState(icon, title, text)); }
  list.forEach(function (m) {
    var parts = (m.key || "").split("-");                       // older saves only have a key like "movie-550"
    m.media_type = m.media_type || parts[0];
    m.id = m.id || Number(parts[1]);
    var card = makeCard(m);
    var poster = card.querySelector(".poster");
    if (!m.poster_path) { poster.style.backgroundImage = ""; poster.classList.remove("has-image"); }
    var remove = document.createElement("button");
    remove.className = "btn small outline remove-btn";
    remove.textContent = "Remove";
    remove.onclick = function (e) { e.stopPropagation(); removeFn(m); };
    card.appendChild(remove);
    row.appendChild(card);
  });
  if (row.updateArrows) { row.updateArrows(); }
}
function renderCollections() {
  fillCardGrid("watchlistRow", "wlCount", "filmlify_watchlist", "🎬", "Your watchlist is empty",
               "Hover a poster and tap +, or open a movie and press Add to Watchlist.", toggleWatchlist);
  fillCardGrid("watchedRow", "wdCount", "filmlify_watched", "✓", "Nothing marked as watched yet",
               "Mark movies you have seen. Reviewing a movie counts too.", toggleWatched);
}

// Old saved entries that only have an id get their poster and details from TMDB
async function fillMissingItems(listName) {
  var list = getList(listName), changed = false;
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    if (f.poster_path !== undefined) { continue; }
    var parts = (f.key || "").split("-");
    if (parts.length < 2) { continue; }
    try {
      var response = await fetch(TMDB_URL + "/" + parts[0] + "/" + parts[1] + "?api_key=" + TMDB_KEY);
      if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
      var d = await response.json();
      f.media_type = parts[0]; f.id = Number(parts[1]);
      f.poster_path = d.poster_path || ""; f.title = d.title || d.name; f.name = d.name || d.title;
      f.overview = d.overview; f.vote_average = d.vote_average;
      f.release_date = d.release_date; f.first_air_date = d.first_air_date;
      f.genre_ids = (d.genres || []).map(function (g) { return g.id; });
      changed = true;
    } catch (error) { console.error("Could not load details for " + f.key + ":", error); }
  }
  if (changed) { saveList(listName, list); renderProfile(); }
}

// ----- Saving the Watchlist and Watched lists in the database -----
function listRow(m) {
  return { tmdb_key: m.media_type + "-" + m.id, media_type: m.media_type, tmdb_id: m.id,
           title: nameOf(m), poster: m.poster_path || "", year: yearOf(m) };
}
function cloudListAdd(table, m) {
  var u = currentUser();
  if (!CLOUD || !u) { return; }
  var row = listRow(m);
  row.user_id = u.id;
  db(table + "?on_conflict=user_id,tmdb_key", "POST", row, { Prefer: "resolution=ignore-duplicates,return=minimal" })
    .catch(function (e) { console.error(e); showMessage("Could not save to the database.", "error"); });
}
function cloudListRemove(table, key) {
  var u = currentUser();
  if (!CLOUD || !u) { return; }
  db(table + "?user_id=eq." + u.id + "&tmdb_key=eq." + encodeURIComponent(key), "DELETE")
    .catch(function (e) { console.error(e); showMessage("Could not update the database.", "error"); });
}
function fromRow(r) {
  return { key: r.tmdb_key, id: r.tmdb_id, media_type: r.media_type, title: r.title, name: r.title,
           poster_path: r.poster || "", release_date: r.year || "", first_air_date: r.year || "" };
}

// When you log in, your saved lists come from the database (so they follow you to any device)
async function syncFromCloud() {
  var u = currentUser();
  if (!CLOUD || !u) { return; }
  try {
    var wl = await db("watchlist?user_id=eq." + u.id + "&select=*&order=created_at.desc");
    var wd = await db("watched?user_id=eq." + u.id + "&select=*&order=created_at.desc");
    var rv = await db("reviews?user_id=eq." + u.id + "&select=*&order=created_at.asc");
    var old = getList("filmlify_reviews");
    saveList("filmlify_watchlist", wl.map(fromRow));
    saveList("filmlify_watched", wd.map(fromRow));
    saveList("filmlify_reviews", rv.map(function (r) {
      var o = old.find(function (x) { return x.key === r.tmdb_key; }) || {};
      return { id: r.local_id || r.id, key: r.tmdb_key, title: r.title, poster: r.poster || "", genres: o.genres,
               stars: r.stars, text: r.body || "",
               date: new Date(r.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) };
    }));
    renderProfile();
  } catch (e) {
    console.error("Could not load your saved data:", e);
    showMessage("Could not load your saved data. Check your connection.", "error");
  }
}

// Everybody's reviews of the open movie (online mode), with usernames, stars and dates
async function paintCommunityReviews() {
  var box = document.getElementById("mReviews");
  var openKey = current.media_type + "-" + current.id;
  box.replaceChildren(spinner());
  try {
    var rows = await db("reviews?tmdb_key=eq." + encodeURIComponent(openKey) + "&select=*,profiles(username)&order=created_at.desc&limit=20");
    if (!current || current.media_type + "-" + current.id !== openKey) { return; }
    box.replaceChildren();
    if (rows.length === 0) { box.textContent = "No reviews yet. Be the first!"; return; }
    var me = currentUser();
    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "item";
      var text = document.createElement("span");
      var who = document.createElement("b");
      who.textContent = "@" + (r.profiles ? r.profiles.username : "someone") + " ";
      if (r.profiles) { who.className = "user-link"; who.dataset.user = r.profiles.username; }
      var stars = document.createElement("span");
      stars.className = "star";
      stars.textContent = starText(r.stars);
      text.appendChild(who);
      text.appendChild(stars);
      if (r.body) { text.appendChild(document.createElement("br")); text.appendChild(document.createTextNode(r.body)); }
      var date = document.createElement("small");
      date.textContent = new Date(r.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      text.appendChild(document.createElement("br"));
      text.appendChild(date);
      row.appendChild(text);
      if (me && r.user_id === me.id) {                              // you can delete your own review
        var del = document.createElement("button");
        del.className = "btn small";
        del.textContent = "✕";
        del.title = "Delete your review";
        del.onclick = function () {
          if (!confirm("Delete your review?")) { return; }
          saveList("filmlify_reviews", getList("filmlify_reviews").filter(function (x) { return x.key !== openKey; }));
          cloudDeleteReview(r.local_id);
          renderProfile();
          row.remove();
          showMessage("Review deleted.");
        };
        row.appendChild(del);
      }
      box.appendChild(row);
    });
  } catch (e) {
    console.error("Could not load reviews:", e);
    box.textContent = "Could not load reviews right now.";
  }
}

if (CLOUD && currentUser()) {
  syncFromCloud().then(function () {
    fillMissingItems("filmlify_watchlist");
    fillMissingItems("filmlify_watched");
    fillMissingReviewData();
  });
} else {
  fillMissingItems("filmlify_watchlist");
  fillMissingItems("filmlify_watched");
}
renderProfile();


/* ============ 26. BOOKING PANEL, PAYMENT, TICKETS AND MY BOOKINGS ============ */
var OMDB_KEY = "";      // optional: a free key from omdbapi.com shows IMDb ratings (empty = TMDB ratings)
var BOOKED_KEY = "filmlify_booked";      // browser-only mode: seats taken (shared by every account on this browser)
var myBookingsList = [];
function el(id) { return document.getElementById(id); }

// "Book Now" under each Now Showing poster picks the movie for the booking panel
function addBookNowButtons() {
  document.querySelectorAll('#theater .row[data-source="/movie/now_playing"] .card').forEach(function (card) {
    if (card.querySelector(".book-btn")) { return; }
    var book = document.createElement("button");
    book.className = "btn wide book-btn";
    book.textContent = "Book Now";
    book.onclick = async function (e) {
      e.stopPropagation();
      var m = known[card.dataset.key];
      if (!m) {                                            // a poster typed by hand: look it up first
        m = await searchTMDB(card.querySelector("b").textContent);
        if (!m) { showMessage("Sorry, could not load this movie.", "error"); return; }
        remember(m);
      }
      showBookingMovie(m);
    };
    card.appendChild(book);
  });
}

// Optional IMDb rating (needs OMDB_KEY)
async function getImdbRating(m) {
  if (!OMDB_KEY) { return null; }
  var cacheKey = "imdb:" + m.id;
  try {
    var saved = localStorage.getItem(cacheKey);
    if (saved) { return saved; }
    var ids = await (await fetch(TMDB_URL + "/movie/" + m.id + "/external_ids?api_key=" + TMDB_KEY)).json();
    if (!ids.imdb_id) { return null; }
    var out = await (await fetch("https://www.omdbapi.com/?i=" + ids.imdb_id + "&apikey=" + OMDB_KEY)).json();
    var rating = out.imdbRating && out.imdbRating !== "N/A" ? out.imdbRating : null;
    if (rating) { localStorage.setItem(cacheKey, rating); }
    return rating;
  } catch (e) { return null; }
}

// Show the chosen movie (poster, genres, rating, story) in the booking panel
function showBookingMovie(m) {
  el("bookTitle").textContent = nameOf(m);
  el("bookPoster").style.backgroundImage = m.poster_path ? "url(" + POSTER_URL + m.poster_path + ")" : "";
  var seen = {};
  el("bookGenres").textContent = genreNames(m).filter(function (g) { return seen[g] ? false : (seen[g] = true); }).slice(0, 3).join(" • ");
  var rating = el("bookRating");
  rating.textContent = m.vote_average ? "★ " + m.vote_average.toFixed(1) : "";
  getImdbRating(m).then(function (r) { if (r && el("bookTitle").textContent === nameOf(m)) { rating.textContent = "★ " + r + " IMDb"; } });
  var story = m.overview || "";
  if (story.length > 260) { story = story.slice(0, 257).replace(/\s+\S*$/, "") + "..."; }
  el("bookOverview").textContent = story;
  el("bookEmpty").hidden = true;
  el("bookBody").hidden = false;
  updateSummary();                                   // new movie: seats start empty and the summary updates
  el("bookPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ----- Where bookings are kept: Supabase when connected, otherwise this browser ----- */
function localBooked() {
  try { return JSON.parse(localStorage.getItem(BOOKED_KEY)) || {}; } catch (e) { return {}; }
}
function rpcMessage(error) {                         // turns a database error into a friendly sentence
  try { return JSON.parse(String(error.message).replace(/^Database error \d+: /, "")).message || "Something went wrong."; }
  catch (e) { return "Could not complete that. Please check your connection and try again."; }
}
async function fetchTakenSeats(key) {
  if (CLOUD) {
    try { return (await db("booked_seats?show_key=eq." + encodeURIComponent(key) + "&select=seat")).map(function (r) { return r.seat; }); }
    catch (e) { console.error("Could not load taken seats:", e); return null; }
  }
  return localBooked()[key] || [];
}
async function loadBookedSeats() {
  if (!el("bookTitle").textContent) { return; }      // no movie chosen yet
  var key = bookingKey();
  var seats = await fetchTakenSeats(key);
  if (seats && key === bookingKey()) {
    bookedSeats = seats;
    chosen = chosen.filter(function (s) { return seats.indexOf(s) < 0; });
    paintSeats();
    updateSummary();
  }
}
function bookingProblem(p) {                         // the same checks the database function makes
  if (!p.seats.length || p.seats.length > 10 || p.seats.some(function (s) { return !/^[A-H]([1-9]|1[0-5])$/.test(s); }) || new Set(p.seats).size !== p.seats.length) { return "Please choose between 1 and 10 valid seats."; }
  if (["GCash", "Maya", "Card"].indexOf(p.method) < 0) { return "Unknown payment method."; }
  if (!p.movie || p.movie.length > 120 || !/^Filmlify - [\w .'-]{1,40}$/.test(p.cinema) || !/^\d{1,2}:\d\d (AM|PM)$/.test(p.time) || !/^\d{4}-\d\d-\d\d$/.test(p.date)) { return "Invalid showtime."; }
  if (showHasStarted(p.date, p.time)) { return "That showtime has already started."; }
  return "";
}
async function createBooking(p) {                    // returns { booking } or { error }
  if (CLOUD) {
    try {
      var b = await db("rpc/book_seats", "POST", { p_movie: p.movie, p_cinema: p.cinema, p_date: p.date, p_time: p.time, p_seats: p.seats, p_method: p.method });
      return { booking: b };
    } catch (e) { console.warn("Booking was not saved:", e.message); return { error: rpcMessage(e) }; }
  }
  var problem = bookingProblem(p);
  if (problem) { return { error: problem }; }
  var taken = localBooked(), already = taken[p.key] || [];
  if (p.seats.some(function (s) { return already.indexOf(s) >= 0; })) { return { error: "Sorry, one of those seats was just taken." }; }
  taken[p.key] = already.concat(p.seats);
  localStorage.setItem(BOOKED_KEY, JSON.stringify(taken));
  var booking = { ref: "FLM-" + Math.random().toString(16).slice(2, 8).toUpperCase(), key: p.key, movie: p.movie, cinema: p.cinema,
                  date: p.date, time: p.time, method: p.method, total: p.seats.length * TICKET_PRICE, seats: p.seats.slice() };
  var list = getList("filmlify_bookings");
  list.unshift(booking);
  saveList("filmlify_bookings", list);
  return { booking: booking };
}
async function cancelBooking(b) {                    // returns {} or { error }
  if (CLOUD) {
    try { await db("rpc/cancel_booking", "POST", { p_ref: b.ref }); return {}; }
    catch (e) { return { error: rpcMessage(e) }; }
  }
  if (showHasStarted(b.date, b.time)) { return { error: "That showtime has already started, so it can no longer be cancelled." }; }
  saveList("filmlify_bookings", getList("filmlify_bookings").filter(function (x) { return x.ref !== b.ref; }));
  var taken = localBooked();
  taken[b.key] = (taken[b.key] || []).filter(function (s) { return b.seats.indexOf(s) < 0; });
  localStorage.setItem(BOOKED_KEY, JSON.stringify(taken));
  return {};
}
async function loadMyBookings() {
  var u = currentUser();
  if (!u) { myBookingsList = []; renderBookings(); return; }
  if (CLOUD) {
    try {
      var rows = await db("bookings?select=*,booked_seats(seat)&order=paid_at.desc");
      myBookingsList = rows.map(function (r) {
        return { ref: r.ref, key: r.show_key, movie: r.movie, cinema: r.cinema, date: r.show_date, time: r.show_time, method: r.method,
                 total: r.total, seats: (r.booked_seats || []).map(function (x) { return x.seat; }).sort() };
      });
    } catch (e) { console.error("Could not load bookings:", e); showMessage("Could not load your bookings.", "error"); }
  } else { myBookingsList = getList("filmlify_bookings"); }
  renderBookings();
}

/* ----- Payment pop-up ----- */
var payModal = el("payModal");
var payLabel = "Pay now";          // the Pay button shows the total, like "Pay ₱ 340.00"
function addPayRow(box, label, value, extraClass) {            // one line of the receipt
  var row = document.createElement("div");
  row.className = "pay-row" + (extraClass ? " " + extraClass : "");
  var name = document.createElement("span"); name.textContent = label;
  var text = document.createElement("b"); text.textContent = value;
  row.appendChild(name); row.appendChild(text); box.appendChild(row);
}
el("payBtn").onclick = function () {
  if (!requireLogin("book tickets")) { return; }
  if (chosen.length === 0) { showMessage("Please select at least one seat.", "error"); return; }
  refreshTimes(); updateSummary();
  if (el("date").value < todayISO()) { showMessage("That date has passed. Please pick today or a later date.", "error"); return; }
  var receipt = el("paySummary");
  receipt.replaceChildren();
  addPayRow(receipt, "Movie", el("bookTitle").textContent);
  addPayRow(receipt, "Cinema", el("cinema").value);
  addPayRow(receipt, "Date & time", el("date").value + " • " + document.querySelector("#times .chosen").textContent);
  addPayRow(receipt, "Seats", chosen.join(", ") + " (" + chosen.length + ")");
  addPayRow(receipt, "Total", el("sumTotal").textContent, "pay-total");
  payLabel = "Pay " + el("sumTotal").textContent;
  el("confirmPay").textContent = payLabel;
  el("payError").textContent = "";
  el("payStep1").style.display = "block"; el("payStep2").style.display = "none";
  payModal.classList.add("open");
};
el("cancelPay").onclick = function () { payModal.classList.remove("open"); };
el("payMethod").onchange = function () {
  var card = this.value === "Card";
  document.querySelectorAll("#payMethods .pay-method").forEach(function (tile) {      // highlight the matching tile
    var picked = tile.dataset.method === el("payMethod").value;
    tile.classList.toggle("on", picked);
    tile.setAttribute("aria-checked", picked ? "true" : "false");
  });
  if (!card) { el("walletLabel").textContent = this.value + " mobile number"; }
  el("cardBox").style.display = card ? "block" : "none";
  el("walletBox").style.display = card ? "none" : "block";
};
el("payMethods").addEventListener("click", function (e) {                              // click a tile to pick it
  var tile = e.target.closest(".pay-method");
  if (!tile) { return; }
  el("payMethod").value = tile.dataset.method;
  el("payMethod").dispatchEvent(new Event("change"));
  el("payError").textContent = "";
});
el("cardNum").oninput = function () { this.value = this.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim(); };
el("cardExp").oninput = function () { var d = this.value.replace(/\D/g, "").slice(0, 4); this.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d; };

function luhn(num) {                                  // checks that a card number is possible
  var sum = 0, flip = false;
  for (var i = num.length - 1; i >= 0; i--) {
    var d = parseInt(num[i], 10); if (flip) { d *= 2; if (d > 9) { d -= 9; } } sum += d; flip = !flip;
  }
  return num.length >= 13 && sum % 10 === 0;
}
function payProblem() {
  var method = el("payMethod").value;
  if (method !== "Card") { return /^09\d{9}$/.test(el("payMobile").value) ? "" : "Enter a valid mobile number (09XXXXXXXXX)."; }
  var num = el("cardNum").value.replace(/\s/g, ""), exp = el("cardExp").value.match(/^(\d\d)\/(\d\d)$/);
  if (!el("cardName").value.trim()) { return "Enter the name on the card."; }
  if (!luhn(num)) { return "That card number is not valid."; }
  if (!exp || +exp[1] < 1 || +exp[1] > 12) { return "Enter the expiry as MM/YY."; }
  var now = new Date();
  if (2000 + +exp[2] < now.getFullYear() || (2000 + +exp[2] === now.getFullYear() && +exp[1] < now.getMonth() + 1)) { return "That card has expired."; }
  if (!/^\d{3,4}$/.test(el("cardCvv").value)) { return "Enter the 3 or 4 digit CVV."; }
  return "";
}
el("confirmPay").onclick = async function () {
  var problem = payProblem();
  el("payError").textContent = problem;
  if (problem) { return; }
  var btn = this; btn.disabled = true; btn.textContent = "Processing...";
  await new Promise(function (r) { setTimeout(r, 1200); });          // pretend the payment provider is working
  // Only the booking is saved. Card and phone details never leave this page.
  var result = await createBooking({
    key: bookingKey(), movie: el("bookTitle").textContent, cinema: el("cinema").value, date: el("date").value,
    time: document.querySelector("#times .chosen").textContent, seats: chosen.slice(), method: el("payMethod").value
  });
  btn.disabled = false; btn.textContent = payLabel;
  if (result.error) { el("payError").textContent = result.error; loadBookedSeats(); return; }
  var booking = result.booking;
  chosen = []; updateSummary(); await loadBookedSeats(); await loadMyBookings();
  ["payMobile", "cardName", "cardNum", "cardExp", "cardCvv"].forEach(function (id) { el(id).value = ""; });
  el("ticketBox").replaceChildren();
  [["Reference", booking.ref], ["Movie", booking.movie], ["Cinema", booking.cinema], ["Date & Time", booking.date + " • " + booking.time],
   ["Seats", booking.seats.join(", ")], ["Paid with", booking.method], ["Total", "₱ " + Number(booking.total).toFixed(2)]].forEach(function (r) {
    var p = document.createElement("p"), x = document.createElement("span"), y = document.createElement("span");
    x.textContent = r[0]; y.textContent = r[1]; p.appendChild(x); p.appendChild(y); el("ticketBox").appendChild(p);
  });
  el("payStep1").style.display = "none"; el("payStep2").style.display = "block";
};
el("closeTicket").onclick = function () { payModal.classList.remove("open"); };
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && el("payStep1").style.display !== "none") { payModal.classList.remove("open"); }
});

/* ----- My Bookings (Profile page) ----- */
function renderBookings() {
  var box = el("myBookings");
  box.replaceChildren();
  el("bkCount").textContent = myBookingsList.length ? "(" + myBookingsList.length + ")" : "";
  if (myBookingsList.length === 0) {
    box.appendChild(emptyState("🎟", "No bookings yet", "Pick a movie in In Theater and choose your seats.", "Book tickets", "#theater"));
    return;
  }
  myBookingsList.forEach(function (b) {
    var row = document.createElement("div");
    row.className = "item booking";
    var text = document.createElement("span");
    var title = document.createElement("b");
    title.textContent = b.movie + "  •  " + b.ref;
    var line1 = document.createElement("small");
    line1.textContent = b.cinema + " • " + b.date + " " + b.time;
    var line2 = document.createElement("small");
    line2.textContent = "Seats " + b.seats.join(", ") + " • " + b.method + " • ₱ " + Number(b.total).toFixed(2);
    text.appendChild(title);
    text.appendChild(document.createElement("br")); text.appendChild(line1);
    text.appendChild(document.createElement("br")); text.appendChild(line2);
    row.appendChild(text);
    if (showHasStarted(b.date, b.time)) {
      var done = document.createElement("small"); done.textContent = "Showtime passed"; row.appendChild(done);
    } else {
      var cancel = document.createElement("button");
      cancel.className = "btn small outline";
      cancel.textContent = "Cancel booking";
      cancel.onclick = async function () {
        if (!confirm("Cancel booking " + b.ref + "?")) { return; }
        var r = await cancelBooking(b);
        if (r.error) { showMessage(r.error, "error"); return; }
        await loadMyBookings(); loadBookedSeats();
        showMessage("Booking cancelled.");
      };
      row.appendChild(cancel);
    }
    box.appendChild(row);
  });
}
loadMyBookings();

// Keep the seat map fresh while the Theater page is open (other people may book seats)
setInterval(function () { if (location.hash === "#theater" && el("bookTitle").textContent) { loadBookedSeats(); } }, 15000);
window.addEventListener("focus", function () { if (location.hash === "#theater" && el("bookTitle").textContent) { loadBookedSeats(); } });

/* ============ TOP 10 TV SHOWS SLIDESHOW ============ */
// Every <div class="hero"> inside #tvSlideshow is one slide.
// Arrows, dots, and auto-play (every 6 seconds) are added here.
(function () {
  var box = document.getElementById("tvSlideshow");
  if (!box) { return; }
  var slides = Array.from(box.querySelectorAll(".hero"));
  var current = 0;
  var timer = null;

  // arrows
  var prev = document.createElement("button");
  prev.className = "slide-arrow prev";
  prev.textContent = "\u2039";
  prev.setAttribute("aria-label", "Previous show");
  var next = document.createElement("button");
  next.className = "slide-arrow next";
  next.textContent = "\u203A";
  next.setAttribute("aria-label", "Next show");

  // dots
  var dotBox = document.createElement("div");
  dotBox.className = "slide-dots";
  var dots = slides.map(function (slide, i) {
    var dot = document.createElement("button");
    dot.setAttribute("aria-label", "Go to show " + (i + 1));
    dot.onclick = function () { show(i); restart(); };
    dotBox.appendChild(dot);
    return dot;
  });

  box.appendChild(prev);
  box.appendChild(next);
  box.appendChild(dotBox);

  function show(i) {
    current = (i + slides.length) % slides.length;
    slides.forEach(function (slide, n) {
      slide.classList.toggle("active", n === current);
      dots[n].classList.toggle("active", n === current);
    });
  }

  function restart() {
    clearInterval(timer);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { return; }
    timer = setInterval(function () { show(current + 1); }, 6000);
  }

  prev.onclick = function () { show(current - 1); restart(); };
  next.onclick = function () { show(current + 1); restart(); };
  box.addEventListener("mouseenter", function () { clearInterval(timer); });   // pause while hovering
  box.addEventListener("mouseleave", restart);

  show(0);
  restart();
})();


/* ============ CLICKABLE LISTS AND POPULAR DIRECTORS ============ */
// Every list on the site: a title, whether it holds movies or TV shows, and its titles with their year.
// To add a film to a list, add [ "Title", year ] to its items. (The year helps TMDB pick the right one.)
var LISTS = {
 "crime-drama": {
  "title": "Masterpiece Crime Drama",
  "kind": "movie",
  "sub": "Lists For You",
  "items": [
   [
    "The Godfather",
    1972
   ],
   [
    "The Godfather Part II",
    1974
   ],
   [
    "Goodfellas",
    1990
   ],
   [
    "Heat",
    1995
   ],
   [
    "Scarface",
    1983
   ],
   [
    "Pulp Fiction",
    1994
   ],
   [
    "City of God",
    2002
   ],
   [
    "The Departed",
    2006
   ],
   [
    "Casino",
    1995
   ],
   [
    "Once Upon a Time in America",
    1984
   ],
   [
    "Infernal Affairs",
    2002
   ],
   [
    "Chinatown",
    1974
   ],
   [
    "Se7en",
    1995
   ],
   [
    "Reservoir Dogs",
    1992
   ]
  ]
 },
 "psych-thrillers": {
  "title": "Psychological Thrillers with Plot Twists",
  "kind": "movie",
  "sub": "Lists For You",
  "items": [
   [
    "Shutter Island",
    2010
   ],
   [
    "Fight Club",
    1999
   ],
   [
    "The Sixth Sense",
    1999
   ],
   [
    "Memento",
    2000
   ],
   [
    "The Prestige",
    2006
   ],
   [
    "Gone Girl",
    2014
   ],
   [
    "Black Swan",
    2010
   ],
   [
    "Prisoners",
    2013
   ],
   [
    "Oldboy",
    2003
   ],
   [
    "Identity",
    2003
   ],
   [
    "The Usual Suspects",
    1995
   ],
   [
    "Se7en",
    1995
   ]
  ]
 },
 "scifi-cinema": {
  "title": "Essential Sci-fi Cinema",
  "kind": "movie",
  "sub": "Lists For You",
  "items": [
   [
    "Metropolis",
    1927
   ],
   [
    "2001: A Space Odyssey",
    1968
   ],
   [
    "Star Wars",
    1977
   ],
   [
    "Alien",
    1979
   ],
   [
    "Blade Runner",
    1982
   ],
   [
    "Back to the Future",
    1985
   ],
   [
    "Terminator 2: Judgment Day",
    1991
   ],
   [
    "The Matrix",
    1999
   ],
   [
    "Inception",
    2010
   ],
   [
    "Interstellar",
    2014
   ],
   [
    "Arrival",
    2016
   ],
   [
    "Blade Runner 2049",
    2017
   ],
   [
    "Dune",
    2021
   ]
  ]
 },
 "dark-thrillers": {
  "title": "Dark Thrillers & Mystery Masterpiece",
  "kind": "movie",
  "sub": "Featured Movie Lists",
  "items": [
   [
    "Rear Window",
    1954
   ],
   [
    "Vertigo",
    1958
   ],
   [
    "Chinatown",
    1974
   ],
   [
    "The Silence of the Lambs",
    1991
   ],
   [
    "Se7en",
    1995
   ],
   [
    "L.A. Confidential",
    1997
   ],
   [
    "Mulholland Drive",
    2001
   ],
   [
    "Mystic River",
    2003
   ],
   [
    "Memories of Murder",
    2003
   ],
   [
    "Zodiac",
    2007
   ],
   [
    "Shutter Island",
    2010
   ],
   [
    "Prisoners",
    2013
   ],
   [
    "Gone Girl",
    2014
   ],
   [
    "Nightcrawler",
    2014
   ]
  ]
 },
 "mcu-infinity": {
  "title": "Complete MCU Infinity Saga",
  "kind": "movie",
  "sub": "Featured Movie Lists",
  "items": [
   [
    "Iron Man",
    2008
   ],
   [
    "The Incredible Hulk",
    2008
   ],
   [
    "Iron Man 2",
    2010
   ],
   [
    "Thor",
    2011
   ],
   [
    "Captain America: The First Avenger",
    2011
   ],
   [
    "The Avengers",
    2012
   ],
   [
    "Iron Man 3",
    2013
   ],
   [
    "Thor: The Dark World",
    2013
   ],
   [
    "Captain America: The Winter Soldier",
    2014
   ],
   [
    "Guardians of the Galaxy",
    2014
   ],
   [
    "Avengers: Age of Ultron",
    2015
   ],
   [
    "Ant-Man",
    2015
   ],
   [
    "Captain America: Civil War",
    2016
   ],
   [
    "Doctor Strange",
    2016
   ],
   [
    "Guardians of the Galaxy Vol. 2",
    2017
   ],
   [
    "Spider-Man: Homecoming",
    2017
   ],
   [
    "Thor: Ragnarok",
    2017
   ],
   [
    "Black Panther",
    2018
   ],
   [
    "Avengers: Infinity War",
    2018
   ],
   [
    "Ant-Man and the Wasp",
    2018
   ],
   [
    "Captain Marvel",
    2019
   ],
   [
    "Avengers: Endgame",
    2019
   ],
   [
    "Spider-Man: Far From Home",
    2019
   ]
  ]
 },
 "neo-noir": {
  "title": "Neo-Noir Cinema Essential",
  "kind": "movie",
  "sub": "Featured Movie Lists",
  "items": [
   [
    "Chinatown",
    1974
   ],
   [
    "Taxi Driver",
    1976
   ],
   [
    "Body Heat",
    1981
   ],
   [
    "Blade Runner",
    1982
   ],
   [
    "Blood Simple",
    1984
   ],
   [
    "L.A. Confidential",
    1997
   ],
   [
    "Fargo",
    1996
   ],
   [
    "Memento",
    2000
   ],
   [
    "Mulholland Drive",
    2001
   ],
   [
    "Collateral",
    2004
   ],
   [
    "Sin City",
    2005
   ],
   [
    "Brick",
    2005
   ],
   [
    "Drive",
    2011
   ],
   [
    "Nightcrawler",
    2014
   ]
  ]
 },
 "perfect-finales": {
  "title": "Shows with Perfect Series Finales",
  "kind": "tv",
  "sub": "by @wembaby • Essential Drama ♥ 14.2k",
  "items": [
   [
    "M*A*S*H",
    1972
   ],
   [
    "Cowboy Bebop",
    1998
   ],
   [
    "Six Feet Under",
    2001
   ],
   [
    "The Shield",
    2002
   ],
   [
    "Avatar: The Last Airbender",
    2005
   ],
   [
    "Friday Night Lights",
    2006
   ],
   [
    "Mad Men",
    2007
   ],
   [
    "Breaking Bad",
    2008
   ],
   [
    "Parks and Recreation",
    2009
   ],
   [
    "Gravity Falls",
    2012
   ],
   [
    "Halt and Catch Fire",
    2014
   ],
   [
    "Better Call Saul",
    2015
   ],
   [
    "Fleabag",
    2016
   ]
  ]
 },
 "mind-bending": {
  "title": "Mind-Bending Mystery & Thrillers",
  "kind": "tv",
  "sub": "by @tyresehaliburnout • Suspense ♥ 9.8k",
  "items": [
   [
    "Twin Peaks",
    1990
   ],
   [
    "Lost",
    2004
   ],
   [
    "Sherlock",
    2010
   ],
   [
    "Black Mirror",
    2011
   ],
   [
    "Hannibal",
    2013
   ],
   [
    "Broadchurch",
    2013
   ],
   [
    "True Detective",
    2014
   ],
   [
    "The Leftovers",
    2014
   ],
   [
    "Fargo",
    2014
   ],
   [
    "Mr. Robot",
    2015
   ],
   [
    "Westworld",
    2016
   ],
   [
    "Dark",
    2017
   ],
   [
    "Mindhunter",
    2017
   ],
   [
    "Severance",
    2022
   ]
  ]
 },
 "scifi-worldbuilding": {
  "title": "Best Sci-Fi Worldbuilding",
  "kind": "tv",
  "sub": "by @lebwrongsend • Futuristic ♥ 4.8k",
  "items": [
   [
    "Star Trek: The Next Generation",
    1987
   ],
   [
    "Babylon 5",
    1993
   ],
   [
    "Firefly",
    2002
   ],
   [
    "Battlestar Galactica",
    2004
   ],
   [
    "Doctor Who",
    2005
   ],
   [
    "Fringe",
    2008
   ],
   [
    "The Expanse",
    2015
   ],
   [
    "Stranger Things",
    2016
   ],
   [
    "Westworld",
    2016
   ],
   [
    "The Mandalorian",
    2019
   ],
   [
    "Love, Death & Robots",
    2019
   ],
   [
    "Foundation",
    2021
   ],
   [
    "Arcane",
    2021
   ],
   [
    "Andor",
    2022
   ],
   [
    "Silo",
    2023
   ]
  ]
 },
 "crime-sagas": {
  "title": "Dark & Gritty Crime Sagas",
  "kind": "tv",
  "sub": "by @kyrieyearning • Masterpieces ♥ 3.2k",
  "items": [
   [
    "The Sopranos",
    1999
   ],
   [
    "The Wire",
    2002
   ],
   [
    "The Shield",
    2002
   ],
   [
    "Breaking Bad",
    2008
   ],
   [
    "Sons of Anarchy",
    2008
   ],
   [
    "Boardwalk Empire",
    2010
   ],
   [
    "Justified",
    2010
   ],
   [
    "Peaky Blinders",
    2013
   ],
   [
    "Banshee",
    2013
   ],
   [
    "Gomorrah",
    2014
   ],
   [
    "Narcos",
    2015
   ],
   [
    "Better Call Saul",
    2015
   ],
   [
    "Ozark",
    2017
   ],
   [
    "Mindhunter",
    2017
   ]
  ]
 },
 "animated-sagas": {
  "title": "Top-Tier Animated Sagas",
  "kind": "tv",
  "sub": "by @oganobatayo • Anime & Animation ♥ 16.6k",
  "items": [
   [
    "Neon Genesis Evangelion",
    1995
   ],
   [
    "Cowboy Bebop",
    1998
   ],
   [
    "One Piece",
    1999
   ],
   [
    "Samurai Jack",
    2001
   ],
   [
    "Avatar: The Last Airbender",
    2005
   ],
   [
    "Death Note",
    2006
   ],
   [
    "Fullmetal Alchemist: Brotherhood",
    2009
   ],
   [
    "Steins;Gate",
    2011
   ],
   [
    "Hunter x Hunter",
    2011
   ],
   [
    "The Legend of Korra",
    2012
   ],
   [
    "Gravity Falls",
    2012
   ],
   [
    "Attack on Titan",
    2013
   ],
   [
    "Rick and Morty",
    2013
   ],
   [
    "BoJack Horseman",
    2014
   ],
   [
    "Arcane",
    2021
   ]
  ]
 },
 "miniseries": {
  "title": "Peak TV Miniseries Masterpieces",
  "kind": "tv",
  "sub": "by @austinrebound • Limited Series ♥ 11.2k",
  "items": [
   [
    "Band of Brothers",
    2001
   ],
   [
    "Angels in America",
    2003
   ],
   [
    "The Pacific",
    2010
   ],
   [
    "Sharp Objects",
    2018
   ],
   [
    "Chernobyl",
    2019
   ],
   [
    "When They See Us",
    2019
   ],
   [
    "Normal People",
    2020
   ],
   [
    "The Queen's Gambit",
    2020
   ],
   [
    "Mare of Easttown",
    2021
   ],
   [
    "Baby Reindeer",
    2024
   ],
   [
    "Adolescence",
    2025
   ]
  ]
 }
};

var listTitleCache = {};
var listToken = 0;      // changes every time a pop-up opens, so an old slow load can never fill a new pop-up

// Find one title on TMDB. Tries the exact year first, then without the year.
async function lookupTitle(title, year, type) {
  var key = type + "|" + title + "|" + year;
  if (key in listTitleCache) { return listTitleCache[key]; }
  async function ask(useYear) {
    var yearPart = useYear ? (type === "movie" ? "&year=" : "&first_air_date_year=") + year : "";
    var response = await fetch(TMDB_URL + "/search/" + type + "?query=" + encodeURIComponent(title) + yearPart + "&api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    return (data.results || []).find(function (r) { return r.poster_path; }) || null;
  }
  var found = null;
  try {
    found = (await ask(true)) || (await ask(false));
    if (found) { found.media_type = type; }
  } catch (error) {
    console.error("Could not look up '" + title + "':", error);
  }
  listTitleCache[key] = found;
  return found;
}

// Show the pop-up with a title, some text, and an empty grid
function openListModal(title, meta, heading) {
  document.getElementById("lTitle").textContent = title;
  document.getElementById("lMeta").textContent = meta || "";
  document.getElementById("lDesc").textContent = "";
  document.getElementById("lActions").replaceChildren();
  document.getElementById("lPic").hidden = true;
  document.getElementById("lHeading").textContent = heading || "";
  document.getElementById("lGrid").replaceChildren();
  document.getElementById("listModal").classList.add("open");
  document.getElementById("listModal").querySelector(".modal-box").scrollTop = 0;
}
function closeListModal() { document.getElementById("listModal").classList.remove("open"); }

function setGridNote(text) {
  var grid = document.getElementById("lGrid");
  grid.replaceChildren();
  var note = document.createElement("p");
  note.className = "list-note";
  note.textContent = text;
  grid.appendChild(note);
}

// ----- A movie/TV list: fill the grid with poster cards (6 at a time, in order) -----
async function openList(id) {
  var list = LISTS[id];
  if (!list) { return; }
  var token = ++listToken;
  var noun = list.kind === "tv" ? "Shows" : "Films";
  openListModal(list.title, list.items.length + " " + noun + " • " + list.sub, "Click any poster for details");
  setGridNote("Loading...");
  var grid = document.getElementById("lGrid");
  var shown = 0;
  for (var i = 0; i < list.items.length; i += 6) {
    var batch = await Promise.all(list.items.slice(i, i + 6).map(function (it) {
      return lookupTitle(it[0], it[1], list.kind);
    }));
    if (token !== listToken) { return; }          // another pop-up was opened meanwhile
    if (shown === 0) { grid.replaceChildren(); }
    batch.forEach(function (m) {
      if (m) { grid.appendChild(makeCard(m)); shown++; }
    });
  }
  if (shown === 0) { setGridNote("Sorry, this list could not be loaded. Check your internet connection and try again."); }
}

// ----- A director: photo, short biography, and the films they directed -----
async function openDirector(name) {
  var token = ++listToken;
  openListModal(name, "", "Known for");
  setGridNote("Loading...");
  var person = await searchPerson(name);
  if (token !== listToken) { return; }
  if (!person) { setGridNote("Sorry, no details found for " + name + "."); return; }

  document.getElementById("lPic").style.backgroundImage = "url(" + PROFILE_URL + person.profile_path + ")";
  document.getElementById("lPic").hidden = false;
  var follow = document.createElement("button");
  follow.className = "btn small follow-btn";
  follow.dataset.name = name;
  document.getElementById("lActions").appendChild(follow);
  paintFollowButtons();

  try {
    var response = await fetch(TMDB_URL + "/person/" + person.id + "?append_to_response=movie_credits&api_key=" + TMDB_KEY);
    if (!response.ok) { throw new Error("TMDB answered with error " + response.status); }
    var data = await response.json();
    if (token !== listToken) { return; }

    var isDirector = data.known_for_department === "Directing";
    var facts = [isDirector ? "Director" : (data.known_for_department === "Acting" ? "Actor" : (data.known_for_department || "Film"))];
    document.getElementById("lHeading").textContent = isDirector ? "Films directed" : "Known for";
    if (data.birthday) { facts.push("Born " + data.birthday.slice(0, 4)); }
    if (data.place_of_birth) { facts.push(data.place_of_birth); }
    document.getElementById("lMeta").textContent = facts.join(" • ");

    var bio = (data.biography || "").trim();
    if (bio.length > 650) { bio = bio.slice(0, 650).replace(/\s+\S*$/, "") + "..."; }
    document.getElementById("lDesc").textContent = bio || "No biography available.";

    var seen = {};
    var credits = (data.movie_credits || {})[isDirector ? "crew" : "cast"] || [];
    var films = credits.filter(function (c) {
      if (isDirector && c.job !== "Director") { return false; }
      if (!isDirector && /\b(self|himself|herself)\b/i.test(c.character || "")) { return false; }   // skip documentaries and talk-show cameos
      if (!c.poster_path || !c.release_date || seen[c.id]) { return false; }
      seen[c.id] = true;
      return true;
    }).sort(function (a, b) { return b.vote_count - a.vote_count; }).slice(0, 12);

    var grid = document.getElementById("lGrid");
    grid.replaceChildren();
    if (films.length === 0) { setGridNote("No films found."); return; }
    films.forEach(function (m) { m.media_type = "movie"; grid.appendChild(makeCard(m)); });
  } catch (error) {
    console.error("Could not load director " + name + ":", error);
    setGridNote("Sorry, this director's films could not be loaded. Try again in a moment.");
  }
}

// Open the pop-up of a movie/show by its name (used by Top News and Film Spotlight)
async function openTitle(title) {
  var found = await searchTMDB(title);
  if (!found) { showMessage("Sorry, no details found for this title."); return; }
  remember(found);
  openMovie(found);
}

// Clicking a list, a director/actor, a news story or the spotlight
document.addEventListener("click", function (e) {
  var link = e.target.closest(".list-link");
  if (!link || e.target.closest(".btn")) { return; }      // buttons inside (Follow, Add to List) keep doing their own job
  if (link.dataset.list) { openList(link.dataset.list); }
  else if (link.dataset.personName) { openDirector(link.dataset.personName); }
  else if (link.dataset.movie) { openTitle(link.dataset.movie); }
});

// Make them reachable with the keyboard too (Tab, then Enter or Space)
document.querySelectorAll(".list-link").forEach(function (el) {
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target === el) { e.preventDefault(); el.click(); }
  });
});

document.getElementById("closeListModal").onclick = closeListModal;
document.getElementById("listModal").onclick = function (e) { if (e.target === this) { closeListModal(); } };


/* ============ EDIT PROFILE POP-UP, CLICKABLE STATS, OTHER PEOPLE'S PROFILES ============ */

// ----- Profile pictures -----
// A picture is a small square image kept as text (a data URL). It is saved in this browser, and in the
// database too when your "profiles" table has an avatar_url column (see the note in the chat).
var hasAvatarColumn = false;
function profileCols() { return "id,username,display_name" + (hasAvatarColumn ? ",avatar_url" : ""); }

function paintAvatar(el, url, name) {
  el.classList.toggle("has-photo", !!url);
  el.style.backgroundImage = url ? "url(" + url + ")" : "";
  el.textContent = url ? "" : ((name || "?").charAt(0).toUpperCase());
}
function miniAvatar(url, name) {
  var el = document.createElement("div");
  el.className = "mini-avatar";
  paintAvatar(el, url, name);
  return el;
}

// Crop the chosen picture to a square and shrink it to 192 x 192
function readAvatar(file) {
  return new Promise(function (resolve, reject) {
    if (!file || file.type.indexOf("image/") !== 0) { reject(new Error("Please choose an image file.")); return; }
    if (file.size > 10 * 1024 * 1024) { reject(new Error("That image is too big (max 10 MB).")); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var size = 192, canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      var side = Math.min(img.width, img.height);
      canvas.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That image could not be opened. Try a JPG or PNG.")); };
    img.src = url;
  });
}

// Does the database have the avatar_url column? If yes, sync my picture and show other people's pictures.
(async function () {
  if (!CLOUD) { return; }
  try {
    await db("profiles?select=avatar_url&limit=1");
    hasAvatarColumn = true;
  } catch (e) { return; }                       // column missing: pictures stay on this device only
  var u = currentUser();
  if (u) {
    try {
      var rows = await db("profiles?id=eq." + u.id + "&select=avatar_url");
      var cloudPic = rows[0] && rows[0].avatar_url;
      if (cloudPic && !profileInfo.avatar) {
        profileInfo.avatar = cloudPic;
        try { localStorage.setItem(userKey("filmlify_profile"), JSON.stringify(profileInfo)); } catch (e) {}
        paintProfileInfo();
      } else if (!cloudPic && profileInfo.avatar) {
        db("profiles?id=eq." + u.id, "PATCH", { avatar_url: profileInfo.avatar }, { Prefer: "return=minimal" }).catch(function () {});
      }
    } catch (e) { console.error(e); }
  }
  if (location.hash === "#people") { loadPeople(); }
  if (location.hash.indexOf("#member/") === 0) { loadMember(decodeURIComponent(location.hash.split("/")[1] || "")); }
})();

// ----- Edit Profile pop-up -----
var editAvatarValue = "";
function closeEditModal() { document.getElementById("editModal").classList.remove("open"); }
function editBioCount() {
  var len = document.getElementById("editBio").value.length;
  document.getElementById("editBioCount").textContent = len + " / 160";
}

document.getElementById("editProfile").onclick = function () {
  if (!requireLogin("edit your profile")) { return; }
  var u = currentUser();
  editAvatarValue = profileInfo.avatar || "";
  document.getElementById("editName").value = profileInfo.name;
  document.getElementById("editUsername").value = u.username;
  document.getElementById("editBio").value = profileInfo.bio === "Film lover" && !localStorage.getItem(userKey("filmlify_profile")) ? "" : profileInfo.bio;
  document.getElementById("editError").textContent = "";
  paintAvatar(document.getElementById("editAvatar"), editAvatarValue, profileInfo.name);
  editBioCount();
  document.getElementById("editModal").classList.add("open");
  document.getElementById("editName").focus();
};
document.getElementById("closeEditModal").onclick = closeEditModal;
document.getElementById("editCancel").onclick = closeEditModal;
document.getElementById("editModal").onclick = function (e) { if (e.target === this) { closeEditModal(); } };
document.getElementById("editBio").addEventListener("input", editBioCount);
document.getElementById("editName").addEventListener("input", function () {
  if (!editAvatarValue) { paintAvatar(document.getElementById("editAvatar"), "", this.value); }
});

document.getElementById("editPhotoBtn").onclick = function () { document.getElementById("editPhotoFile").click(); };
document.getElementById("editPhotoFile").onchange = async function () {
  var file = this.files[0];
  this.value = "";
  if (!file) { return; }
  try {
    editAvatarValue = await readAvatar(file);
    paintAvatar(document.getElementById("editAvatar"), editAvatarValue, document.getElementById("editName").value);
    document.getElementById("editError").textContent = "";
  } catch (error) { document.getElementById("editError").textContent = error.message; }
};
document.getElementById("editPhotoRemove").onclick = function () {
  editAvatarValue = "";
  paintAvatar(document.getElementById("editAvatar"), "", document.getElementById("editName").value);
};

// Moves a person's saved data (reviews, watchlist...) to their new username
function renameLocalData(oldName, newName) {
  var moves = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k.indexOf("filmlify") === 0 && k.slice(-(oldName.length + 1)) === ":" + oldName) { moves.push(k); }
  }
  moves.forEach(function (k) {
    localStorage.setItem(k.slice(0, -oldName.length) + newName, localStorage.getItem(k));
    localStorage.removeItem(k);
  });
}

document.getElementById("editSave").onclick = async function () {
  var u = currentUser();
  if (!u) { return; }
  var errorBox = document.getElementById("editError");
  var saveButton = this;
  var name = document.getElementById("editName").value.trim();
  var username = document.getElementById("editUsername").value.trim().replace(/^@/, "").toLowerCase();
  var bio = document.getElementById("editBio").value.trim();
  errorBox.textContent = "";

  if (!name) { errorBox.textContent = "Please enter a display name."; return; }
  if (!/^[a-z0-9_]{3,20}$/.test(username)) { errorBox.textContent = "Username: 3-20 letters, numbers or _ only."; return; }

  var usernameChanged = username !== u.username;
  saveButton.disabled = true;
  saveButton.textContent = "Saving...";
  try {
    // 1. the username must be free
    if (usernameChanged) {
      if (CLOUD) {
        var taken = await db("profiles?username=eq." + encodeURIComponent(username) + "&select=id");
        if (taken.length && taken[0].id !== u.id) { errorBox.textContent = "That username is already taken."; return; }
      } else if (accounts().some(function (a) { return a.username === username; })) {
        errorBox.textContent = "That username is already taken."; return;
      }
    }

    // 2. save to the database
    if (CLOUD) {
      var changes = { display_name: name, bio: bio };
      if (usernameChanged) { changes.username = username; }
      try {
        await db("profiles?id=eq." + u.id, "PATCH", changes, { Prefer: "return=minimal" });
      } catch (e) {
        console.error(e);
        errorBox.textContent = /duplicate|23505|unique/i.test(String(e.message)) ? "That username is already taken." : "Could not save to the database. Please try again.";
        return;
      }
      if (hasAvatarColumn) {
        db("profiles?id=eq." + u.id, "PATCH", { avatar_url: editAvatarValue || null }, { Prefer: "return=minimal" }).catch(function (e) { console.error(e); });
      }
      var session = cloudSession();
      if (session) {
        session.displayName = name; session.bio = bio; session.username = username;
        localStorage.setItem("filmlify_cloud", JSON.stringify(session));
      }
    }

    // 3. save in this browser (under the OLD username key first, then move everything to the new name)
    profileInfo = { name: name, bio: bio, avatar: editAvatarValue };
    try { localStorage.setItem("filmlify_profile:" + u.username, JSON.stringify(profileInfo)); } catch (e) {
      errorBox.textContent = "The photo is too large for this browser to save. Try a smaller picture."; return;
    }
    if (usernameChanged) {
      renameLocalData(u.username, username);
      if (!CLOUD) {
        var all = accounts();
        var account = all.find(function (a) { return a.username === u.username; });
        if (account) { account.username = username; localStorage.setItem("filmlify_accounts", JSON.stringify(all)); }
        localStorage.setItem("filmlify_session", username);
      }
      sessionStorage.setItem("flash", "Profile updated! You are now @" + username + ".");
      sessionStorage.setItem("goto", "#profile");
      location.reload();                        // reloads so everything uses the new username
      return;
    }
    paintProfileInfo();
    closeEditModal();
    showMessage("Profile updated!");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save changes";
  }
};

// ----- Lists of people (Followers / Following) -----
var reloadPeopleModal = null;
function closePeopleModal() { document.getElementById("peopleModal").classList.remove("open"); reloadPeopleModal = null; }
document.getElementById("closePeopleModal").onclick = closePeopleModal;
document.getElementById("peopleModal").onclick = function (e) { if (e.target === this) { closePeopleModal(); } };

// title + a function that fills the box. The function is kept so the list can refresh after Follow / Unfollow.
function openPeopleModal(title, fill) {
  var body = document.getElementById("pmBody");
  document.getElementById("pmTitle").textContent = title;
  document.getElementById("peopleModal").classList.add("open");
  var run = async function () {
    try { await fill(body); }
    catch (e) { console.error(e); body.textContent = "Sorry, this list could not be loaded. Please try again."; }
  };
  reloadPeopleModal = run;
  body.replaceChildren(spinner());
  run();
}

// Go to someone's profile (your own name goes to your own Profile page)
function openUserProfile(username, id) {
  closePeopleModal();
  closeMovie();
  closeListModal();
  var u = currentUser();
  if (u && (u.id === id || u.username === username)) { location.hash = "#profile"; }
  else { location.hash = "#member/" + encodeURIComponent(username); }
}
document.addEventListener("click", function (e) {
  var link = e.target.closest("[data-user]");
  if (link) { openUserProfile(link.dataset.user); }
});

function fillStarsFollowed(body) {
  var stars = getList("filmlify_following");
  if (stars.length === 0) { return; }
  var heading = document.createElement("h3");
  heading.textContent = "Stars";
  body.appendChild(heading);
  stars.forEach(function (starName) {
    var row = document.createElement("div");
    row.className = "item person-row";
    var main = document.createElement("div");
    main.className = "person-main";
    main.appendChild(miniAvatar("", starName));
    var label = document.createElement("b");
    label.textContent = starName;
    main.appendChild(label);
    var button = document.createElement("button");
    button.className = "btn small follow-btn";
    button.dataset.name = starName;
    row.appendChild(main);
    row.appendChild(button);
    row.onclick = function (e) { if (!e.target.closest(".btn")) { openDirector(starName); } };
    body.appendChild(row);
  });
  paintFollowButtons();
}

async function openMyFollowers() {
  if (!requireLogin("see your followers")) { return; }
  openPeopleModal("Followers", async function (body) {
    if (!CLOUD) { body.textContent = "The accounts database is not connected yet."; return; }
    await refreshFollowing();
    fillPeopleList(body, await profilesByIds(myFollowers), "No followers yet.");
  });
}
async function openMyFollowing() {
  if (!requireLogin("see who you follow")) { return; }
  openPeopleModal("Following", async function (body) {
    var people = [];
    if (CLOUD) { await refreshFollowing(); people = await profilesByIds(myFollowing); }
    body.replaceChildren();
    if (people.length) {
      var heading = document.createElement("h3");
      heading.textContent = "People";
      body.appendChild(heading);
      people.forEach(function (p) { body.appendChild(personRow(p)); });
    }
    fillStarsFollowed(body);
    if (!body.children.length) { body.textContent = "You are not following anyone yet."; }
  });
}

function scrollToSection(el) {
  var section = el.closest(".block") || el;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  section.classList.remove("flash-section");
  void section.offsetWidth;                      // restarts the highlight animation
  section.classList.add("flash-section");
}

// Click the numbers at the top of your Profile
document.querySelectorAll("#profile .stat-link").forEach(function (el) {
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  var go = function () {
    var what = el.dataset.stat;
    if (what === "followers") { openMyFollowers(); }
    else if (what === "following") { openMyFollowing(); }
    else if (what === "watched") { scrollToSection(document.getElementById("watchedRow")); }
    else if (what === "watchlist") { scrollToSection(document.getElementById("watchlistRow")); }
    else if (what === "reviews") { scrollToSection(document.getElementById("reviewList")); }
  };
  el.onclick = go;
  el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
});

// ----- Another person's profile page (#member/username) -----
var memberToken = 0;
async function loadMember(username) {
  var token = ++memberToken;
  var u = currentUser();
  var nameEl = document.getElementById("uName");
  var bioEl = document.getElementById("uBio");
  var followBtn = document.getElementById("uFollow");
  var reviewsBox = document.getElementById("uReviews");
  if (!u || !username) { return; }
  if (u.username === username) { location.replace("#profile"); return; }

  if (!CLOUD) { nameEl.textContent = "Not available"; bioEl.textContent = "The accounts database is not connected yet."; followBtn.hidden = true; return; }

  followBtn.hidden = true;
  nameEl.textContent = "Loading...";
  bioEl.textContent = "";
  paintAvatar(document.getElementById("uAvatar"), "", "?");
  reviewsBox.replaceChildren(spinner());
  ["uStatFollowers", "uStatFollowing", "uStatReviews"].forEach(function (id) { document.getElementById(id).textContent = "0"; });

  try {
    var rows = await db("profiles?username=eq." + encodeURIComponent(username) + "&select=" + profileCols() + ",bio");
    if (token !== memberToken) { return; }
    if (rows.length === 0) {
      nameEl.textContent = "User not found";
      bioEl.textContent = "Nobody has the username @" + username + ".";
      reviewsBox.replaceChildren();
      return;
    }
    var p = rows[0];
    nameEl.textContent = p.display_name || p.username;
    bioEl.textContent = p.bio ? "@" + p.username + " • " + p.bio : "@" + p.username;
    paintAvatar(document.getElementById("uAvatar"), p.avatar_url, p.display_name || p.username);

    await refreshFollowing();
    if (token !== memberToken) { return; }
    var isFollowing = myFollowing.indexOf(p.id) >= 0;
    followBtn.hidden = false;
    followBtn.textContent = isFollowing ? "Following ✓" : "Follow";
    followBtn.onclick = function () { toggleFollowUser(p.id, p.username); };

    var results = await Promise.all([
      db("follows?following=eq." + p.id + "&select=follower"),
      db("follows?follower=eq." + p.id + "&select=following"),
      db("reviews?user_id=eq." + p.id + "&select=*&order=created_at.desc&limit=30")
    ]);
    if (token !== memberToken) { return; }
    var followerIds = results[0].map(function (r) { return r.follower; });
    var followingIds = results[1].map(function (r) { return r.following; });
    var reviews = results[2];

    document.getElementById("uStatFollowers").textContent = followerIds.length;
    document.getElementById("uStatFollowing").textContent = followingIds.length;
    document.getElementById("uStatReviews").textContent = reviews.length;

    document.querySelectorAll("#member .stat-link").forEach(function (el) {
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      var go = function () {
        var followers = el.dataset.ustat === "followers";
        openPeopleModal((p.display_name || p.username) + (followers ? "'s Followers" : " is Following"), async function (body) {
          await refreshFollowing();
          fillPeopleList(body, await profilesByIds(followers ? followerIds : followingIds), followers ? "No followers yet." : "Not following anyone yet.");
        });
      };
      el.onclick = go;
      el.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
    });

    reviewsBox.replaceChildren();
    if (reviews.length === 0) { reviewsBox.textContent = "@" + p.username + " has not written any reviews yet."; return; }
    reviews.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "item with-pic";
      var pic = document.createElement("div");
      pic.className = "pic tall";
      if (r.poster) { pic.classList.add("has-image"); pic.style.backgroundImage = "url(" + POSTER_URL + r.poster + ")"; }
      var text = document.createElement("span");
      var title = document.createElement("b");
      title.textContent = r.title + " ";
      var stars = document.createElement("span");
      stars.className = "star";
      stars.textContent = starText(r.stars);
      text.appendChild(title);
      text.appendChild(stars);
      if (r.body) { text.appendChild(document.createElement("br")); text.appendChild(document.createTextNode(r.body)); }
      var date = document.createElement("small");
      date.textContent = new Date(r.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      text.appendChild(document.createElement("br"));
      text.appendChild(date);
      row.appendChild(pic);
      row.appendChild(text);
      reviewsBox.appendChild(row);
    });
  } catch (e) {
    console.error("Could not load profile:", e);
    if (token === memberToken) { nameEl.textContent = "Something went wrong"; bioEl.textContent = "Could not load this profile. Please try again."; reviewsBox.replaceChildren(); }
  }
}
