// Seasonal sections stay hidden until LIVE_SEASON is set. ?preview=christmas shows them for this tab; ?preview=off clears it.
(function () {
  var LIVE_SEASON = "";
  var KNOWN_SEASONS = ["christmas"];
  var STORAGE_KEY = "tranche.previewSeason";
  var season = LIVE_SEASON;
  var preview = new URLSearchParams(window.location.search).get("preview");

  try {
    if (preview === "off") {
      sessionStorage.removeItem(STORAGE_KEY);
    } else if (KNOWN_SEASONS.indexOf(preview) !== -1) {
      sessionStorage.setItem(STORAGE_KEY, preview);
    }
    season = sessionStorage.getItem(STORAGE_KEY) || season;
  } catch (error) {
    if (KNOWN_SEASONS.indexOf(preview) !== -1) season = preview;
  }

  if (season) {
    document.documentElement.setAttribute("data-season", season);
  }
})();
