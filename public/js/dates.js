(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HockeyDates = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function pad(n) {
    n = String(n);
    return n.length < 2 ? "0" + n : n;
  }

  function partsOf(date) {
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    var map = {};
    parts.forEach(function (p) {
      if (p.type !== "literal") map[p.type] = p.value;
    });
    if (map.hour === "24") map.hour = "00";
    return map;
  }

  // Date-only values stay on that calendar day. Instants use Eastern time
  // (America/New_York) with a literal EST label.
  function formatTableDate(value) {
    if (value == null || value === "") return "—";
    var s = String(value).trim();
    var day = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (day) return day[2] + "/" + day[3] + "/" + day[1];
    var compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return compact[2] + "/" + compact[3] + "/" + compact[1];
    var t = Date.parse(s);
    if (!isFinite(t)) return s;
    var map = partsOf(new Date(t));
    return map.month + "/" + map.day + "/" + map.year + " " + pad(map.hour) + ":" + pad(map.minute) + " EST";
  }

  // Default matchup slate rolls at 6:00 AM Eastern. At and after 6:00 the
  // date is today's Eastern calendar day. Before 6:00 it is the previous
  // Eastern calendar day. Explicit ?date= values are not passed through here.
  function etSlateDate(now) {
    var map = partsOf(now instanceof Date ? now : new Date());
    var ymd = map.year + "-" + map.month + "-" + map.day;
    if (Number(map.hour) < 6) {
      var d = new Date(ymd + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    }
    return ymd;
  }

  return { formatTableDate: formatTableDate, etSlateDate: etSlateDate };
});
