/**
 * auto_timezone.js  —  v3  (2025-05-29)
 * 动态侦测代理出口 IP 的时区并统一 JSON / HTML 中的时间信息
 * 适用于 Surge (Mac / iOS) 5.10+
 *
 * KV Keys:
 *   TZ_STRING : IANA TZ  如 "America/New_York"
 *   TZ_OFFSET : 反号分钟偏移 例如  +240 / -480
 *   TZ_TS     : 缓存时间戳 (秒)
 */

const CACHE_SECONDS = 1800;            // 30 分钟刷新一次
const API_URL       = "https://ipapi.co/json";   // 同时支持 HTTP/HTTP2

async function ensureTimezone() {
  const nowSec = Math.floor(Date.now() / 1000);
  const last   = parseInt($persistentStore.read("TZ_TS") || "0", 10);
  let   tz     = $persistentStore.read("TZ_STRING");
  let   offStr = $persistentStore.read("TZ_OFFSET");

  // 如果缓存失效 → 重新拉取
  if (!tz || !offStr || nowSec - last > CACHE_SECONDS) {
    console.log("[TZ] Cache miss → querying", API_URL);
    const data = await new Promise(resolve =>
      $httpClient.get({ url: API_URL, timeout: 5e3 }, (err, resp, body) => {
        if (err) return resolve(null);
        try     { return resolve(JSON.parse(body)); }
        catch   { return resolve(null); }
      })
    );
    if (!data || !data.timezone || !data.utc_offset) {
      console.log("[TZ] Query failed, fallback UTC");
      tz     = "UTC";
      offStr = "0";            //  getTimezoneOffset → 0
    } else {
      tz = data.timezone;      // "America/New_York"
      // ipapi.co 的 utc_offset 如 "+0800" 或 "-0430"
      const m = data.utc_offset.match(/([+-])(\d{2})(\d{2})/);
      let off = 0;             // 分钟偏移 (正 = 东八)
      if (m) {
        off = (parseInt(m[2])*60 + parseInt(m[3])) * (m[1] === "-" ? -1 : 1);
      }
      offStr = String(-off);   // 存储「反号」⇄ JS getTimezoneOffset 规则
    }
    $persistentStore.write(tz,     "TZ_STRING");
    $persistentStore.write(offStr, "TZ_OFFSET");
    $persistentStore.write(String(nowSec), "TZ_TS");
  }
  return { tz, off: parseInt(offStr, 10) };
}

// === 主流程：根据 Content-Type 分支 ===
(async () => {
  const { tz, off } = await ensureTimezone();
  const ct  = ($response.headers["Content-Type"] || "").toLowerCase();

  if (ct.includes("application/json")) {
    try {
      const data = JSON.parse($response.body);

      const patch = (obj, keys, val) =>
        keys.forEach(k => { if (k in obj) obj[k] = val; });

      patch(data, ["timezone", "time_zone"], tz);
      patch(data, ["utc_offset", "gmt_offset"], -off / 60);   // ±小时
      patch(data, ["utc_offset_minutes", "offset_sec", "offset"], -off); // ±分钟

      $done({ body: JSON.stringify(data) });
    } catch { $done({}); }

  } else if (ct.includes("text/html")) {
    const inject = `
<script>
(function () {
  const TZ = "${tz}";
  const OFFSET = ${off};   /* 反号分钟偏移 */

  /* getTimezoneOffset() → -OFFSET */
  Date.prototype.getTimezoneOffset = function () { return -OFFSET; };

  /* Intl.DateTimeFormat */
  const _F = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function (loc, opt={}) { opt.timeZone = TZ; return _F.call(this, loc, opt); };
  Intl.DateTimeFormat.prototype = _F.prototype;
  const _R = _F.prototype.resolvedOptions;
  _F.prototype.resolvedOptions = function () {
    const r = _R.call(this); r.timeZone = TZ; return r;
  };
  console.log("[Surge] TZ spoof:", TZ, "offset(min)", -OFFSET);
})();
</script>`;
    const newBody = $response.body.replace(/<head[^>]*>/i, m => m + inject);
    $done({ body: newBody });

  } else {
    $done({});
  }
})();
