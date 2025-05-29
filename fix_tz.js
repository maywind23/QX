// @supported 5
let data = JSON.parse($response.body);
if (data.timezone) {
  data.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
}
$done({body: JSON.stringify(data)});
