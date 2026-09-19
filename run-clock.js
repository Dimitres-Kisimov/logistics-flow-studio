/* One model tick is one simulated minute. 1x means one simulated second/second. */
(function () {
  "use strict";
  const WT = window.WT = window.WT || {};
  function duration(value, unit) {
    const scale = { minutes: 1, hours: 60, days: 1440 }[unit];
    const minutes = value * scale;
    if (!Number.isFinite(value) || !Number.isFinite(minutes) || minutes < 1 || minutes > 525600 || !Number.isInteger(minutes))
      throw new Error("Choose a duration from 1 minute to 365 days, in whole simulated minutes.");
    return minutes;
  }
  function create(minutes) {
    return { elapsed: 0, limit: duration(minutes, "minutes"), previous: null };
  }
  function advance(clock, minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) throw new Error("Invalid elapsed time.");
    const before = Math.floor(clock.elapsed + 1e-9);
    clock.elapsed = Math.min(clock.limit, clock.elapsed + minutes);
    return Math.floor(clock.elapsed + 1e-9) - before;
  }
  function frame(clock, timestamp, speed) {
    if (!Number.isFinite(timestamp) || !Number.isFinite(speed) || speed < 1 || speed > 100)
      throw new Error("Clock needs a timestamp and speed between 1x and 100x.");
    if (clock.previous === null) { clock.previous = timestamp; return 0; }
    const seconds = Math.max(0, Math.min(1, (timestamp - clock.previous) / 1000));
    clock.previous = timestamp;
    return advance(clock, seconds * speed / 60);
  }
  function text(minutes) {
    const total = Math.floor(minutes * 60 + 1e-6);
    return Math.floor(total / 86400) + "d " + String(Math.floor(total / 3600) % 24).padStart(2, "0") + ":" +
      String(Math.floor(total / 60) % 60).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }
  WT.runClock = { duration, create, advance, frame, text };
}());
