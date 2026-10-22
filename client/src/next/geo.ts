/**
 * Where our consensus nodes are. Node keys arrive as `CC-City` (e.g.
 * `DE-Frankfurt am Main`, `HK-Hong_Kong`, `DE-Rödelheim`), and the set grows,
 * so: a table of datacenter cities and districts, then a country centroid,
 * then "unplaced".
 */

export interface Place {
  key: string;          // the raw node key
  cc: string;           // ISO country code, upper case
  name: string;         // display name, e.g. "Rödelheim"
  code: string;         // three-ish letter tag for tight spaces
  metro?: string;       // the metro a district belongs to, e.g. "Frankfurt"
  lat?: number;
  lon?: number;
  approx: boolean;      // placed by country only
}

/** lower case, accents and punctuation stripped, single spaces */
export function norm(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase()
    .replace(/[_\-.,'’()/]+/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// name | CC | lat | lon | code | aliases (comma separated) | metro
const CITIES = `
frankfurt|DE|50.110|8.682|FRA|frankfurt am main,frankfurt main,frankfurt a m,ffm|
rodelheim|DE|50.125|8.610|RÖD|frankfurt rodelheim|Frankfurt
fechenheim|DE|50.125|8.752|FEC|frankfurt fechenheim|Frankfurt
sossenheim|DE|50.120|8.570|SOS||Frankfurt
ostend|DE|50.113|8.705|OST|frankfurt ostend|Frankfurt
bockenheim|DE|50.122|8.650|BOC||Frankfurt
eschborn|DE|50.143|8.570|ESC||Frankfurt
offenbach|DE|50.096|8.776|OFF|offenbach am main|Frankfurt
nuremberg|DE|49.452|11.077|NUE|nurnberg|
falkenstein|DE|50.478|12.371|FSN||
munich|DE|48.137|11.575|MUC|munchen|
berlin|DE|52.520|13.405|BER||
hamburg|DE|53.551|9.994|HAM||
dusseldorf|DE|51.228|6.773|DUS||
cologne|DE|50.938|6.960|CGN|koln|
amsterdam|NL|52.370|4.895|AMS||
schiphol|NL|52.310|4.768|AMS|schiphol rijk|Amsterdam
haarlem|NL|52.387|4.646|HRL||Amsterdam
rotterdam|NL|51.924|4.478|RTM||
eygelshoven|NL|50.890|6.060|EYG||
brussels|BE|50.850|4.352|BRU|bruxelles|
luxembourg|LU|49.612|6.130|LUX||
london|GB|51.507|-0.128|LON|city of london|
slough|GB|51.511|-0.595|SLO||London
manchester|GB|53.480|-2.243|MAN||
paris|FR|48.857|2.352|PAR||
roubaix|FR|50.690|3.181|RBX||
gravelines|FR|50.987|2.128|GRA||
strasbourg|FR|48.573|7.752|SBG||
marseille|FR|43.296|5.370|MRS||
dublin|IE|53.350|-6.260|DUB||
warsaw|PL|52.230|21.012|WAW|warszawa|
vilnius|LT|54.687|25.280|VNO||
riga|LV|56.950|24.105|RIX||
tallinn|EE|59.437|24.754|TLL||
prague|CZ|50.076|14.438|PRG|praha|
vienna|AT|48.208|16.373|VIE|wien|
budapest|HU|47.498|19.040|BUD||
bucharest|RO|44.427|26.103|OTP|bucuresti|
sofia|BG|42.698|23.322|SOF||
belgrade|RS|44.787|20.457|BEG||
zagreb|HR|45.815|15.982|ZAG||
athens|GR|37.984|23.728|ATH||
istanbul|TR|41.008|28.978|IST||
kyiv|UA|50.450|30.523|KBP|kiev|
stockholm|SE|59.329|18.069|STO||
oslo|NO|59.914|10.752|OSL||
copenhagen|DK|55.676|12.568|CPH|kobenhavn|
helsinki|FI|60.170|24.938|HEL||
zurich|CH|47.377|8.541|ZRH||
geneva|CH|46.204|6.143|GVA|geneve|
milan|IT|45.464|9.190|MIL|milano|
rome|IT|41.903|12.496|ROM|roma|
madrid|ES|40.417|-3.704|MAD||
barcelona|ES|41.387|2.168|BCN||
lisbon|PT|38.722|-9.139|LIS|lisboa|
new york|US|40.713|-74.006|NYC|new york city,nyc,manhattan,brooklyn|
newark|US|40.736|-74.172|EWR||New York
secaucus|US|40.790|-74.057|SEC||New York
piscataway|US|40.555|-74.464|PSC||New York
jersey city|US|40.718|-74.043|JCY||New York
carteret|US|40.577|-74.228|CRT||New York
weehawken|US|40.770|-74.020|WEE||New York
clifton|US|40.858|-74.164|CLF||New York
ashburn|US|39.044|-77.487|ASH||Washington
reston|US|38.969|-77.341|RES||Washington
sterling|US|39.006|-77.429|STE||Washington
herndon|US|38.970|-77.386|HRN||Washington
manassas|US|38.751|-77.475|MNS||Washington
washington|US|38.907|-77.037|WAS|washington dc|
boston|US|42.360|-71.059|BOS||
philadelphia|US|39.953|-75.165|PHL||
chicago|US|41.878|-87.630|CHI|elk grove village|
dallas|US|32.777|-96.797|DAL|richardson,plano|
fort worth|US|32.755|-97.331|DFW||Dallas
houston|US|29.760|-95.370|HOU||
austin|US|30.267|-97.743|AUS||
atlanta|US|33.749|-84.388|ATL||
miami|US|25.762|-80.192|MIA||
columbus|US|39.961|-82.999|CMH||
kansas city|US|39.100|-94.579|MCI||
st louis|US|38.627|-90.199|STL|saint louis|
minneapolis|US|44.978|-93.265|MSP||
denver|US|39.739|-104.990|DEN||
salt lake city|US|40.761|-111.891|SLC||
phoenix|US|33.448|-112.074|PHX||
las vegas|US|36.170|-115.140|LAS||
los angeles|US|34.052|-118.244|LAX|la|
glendale|US|34.143|-118.255|GLN||Los Angeles
el segundo|US|33.919|-118.416|ELS||Los Angeles
irvine|US|33.684|-117.826|IRV||Los Angeles
san diego|US|32.716|-117.161|SAN||
san jose|US|37.338|-121.886|SJC||
santa clara|US|37.354|-121.955|SNC||San Jose
sunnyvale|US|37.369|-122.036|SUN||San Jose
fremont|US|37.548|-121.989|FMT||San Jose
palo alto|US|37.442|-122.143|PAO||San Jose
san francisco|US|37.775|-122.419|SFO||
seattle|US|47.606|-122.332|SEA||
portland|US|45.515|-122.679|PDX|hillsboro|
toronto|CA|43.653|-79.383|YYZ||
montreal|CA|45.502|-73.567|YUL|beauharnois|
vancouver|CA|49.283|-123.121|YVR||
calgary|CA|51.045|-114.072|YYC||
mexico city|MX|19.433|-99.133|MEX|ciudad de mexico|
queretaro|MX|20.588|-100.390|QRO||
sao paulo|BR|-23.551|-46.633|GRU||
rio de janeiro|BR|-22.907|-43.173|RIO||
buenos aires|AR|-34.604|-58.382|EZE||
santiago|CL|-33.449|-70.669|SCL||
bogota|CO|4.711|-74.072|BOG||
lima|PE|-12.046|-77.043|LIM||
tokyo|JP|35.676|139.650|TYO|inzai|
osaka|JP|34.694|135.502|OSA||
singapore|SG|1.352|103.820|SIN||
hong kong|HK|22.320|114.170|HKG|tsuen wan,kwai chung,tseung kwan o|
taipei|TW|25.033|121.565|TPE||
seoul|KR|37.567|126.978|SEL||
shanghai|CN|31.230|121.474|SHA||
beijing|CN|39.904|116.407|PEK||
shenzhen|CN|22.543|114.058|SZX||
bangkok|TH|13.756|100.502|BKK||
jakarta|ID|-6.208|106.846|JKT||
kuala lumpur|MY|3.139|101.687|KUL||
manila|PH|14.600|120.984|MNL||
ho chi minh city|VN|10.823|106.630|SGN|ho chi minh,saigon|
hanoi|VN|21.028|105.854|HAN||
mumbai|IN|19.076|72.878|BOM|bombay,navi mumbai|
chennai|IN|13.083|80.271|MAA||
bangalore|IN|12.972|77.595|BLR|bengaluru|
delhi|IN|28.704|77.103|DEL|new delhi,noida|
dubai|AE|25.205|55.271|DXB||
abu dhabi|AE|24.454|54.377|AUH||
fujairah|AE|25.129|56.326|FJR||
tel aviv|IL|32.085|34.782|TLV|tel aviv yafo|
doha|QA|25.286|51.533|DOH||
riyadh|SA|24.713|46.675|RUH||
bahrain|BH|26.067|50.558|BAH|manama|
johannesburg|ZA|-26.204|28.047|JNB|midrand,sandton|
cape town|ZA|-33.925|18.424|CPT||
lagos|NG|6.524|3.379|LOS||
nairobi|KE|-1.292|36.822|NBO||
cairo|EG|30.044|31.236|CAI||
sydney|AU|-33.869|151.209|SYD||
melbourne|AU|-37.814|144.963|MEL||
brisbane|AU|-27.470|153.026|BNE||
perth|AU|-31.950|115.861|PER||
auckland|NZ|-36.849|174.763|AKL||
`;

// Geographic-ish centre of each country (a fallback, flagged as approximate)
const COUNTRIES = `
US 39.8 -98.6|CA 50.0 -96.0|MX 23.6 -102.5|BR -10.8 -52.9|AR -35.4 -65.2|CL -33.0 -71.0|CO 4.1 -72.9|PE -9.2 -75.0
GB 54.0 -2.0|IE 53.2 -8.2|FR 46.6 2.4|DE 51.2 10.4|NL 52.2 5.3|BE 50.6 4.6|LU 49.8 6.1|CH 46.8 8.2|AT 47.6 14.1
IT 42.8 12.6|ES 40.2 -3.6|PT 39.6 -8.0|PL 52.1 19.4|CZ 49.8 15.5|SK 48.7 19.7|HU 47.2 19.4|RO 45.9 25.0|BG 42.7 25.5
RS 44.0 20.8|HR 45.1 15.2|SI 46.1 14.8|GR 39.1 22.0|TR 39.0 35.2|UA 49.0 31.4|LT 55.2 23.9|LV 56.9 24.6|EE 58.7 25.0
FI 64.0 26.0|SE 62.0 15.0|NO 61.5 9.0|DK 56.0 10.0|IS 64.9 -18.6|RU 55.8 37.6|MD 47.2 28.5|BY 53.7 27.9
JP 36.2 138.3|KR 36.5 127.9|CN 35.9 104.2|HK 22.32 114.17|TW 23.7 121.0|SG 1.35 103.82|MY 4.2 102.0|TH 15.9 100.9
VN 16.0 107.8|ID -2.5 118.0|PH 12.9 121.8|IN 21.0 78.0|PK 30.4 69.3|BD 23.7 90.4|AE 24.4 54.4|SA 24.0 45.0
QA 25.3 51.2|BH 26.07 50.56|IL 31.4 34.9|EG 26.8 30.8|ZA -29.0 25.0|NG 9.1 8.7|KE 0.0 37.9|MA 31.8 -7.1
AU -25.3 133.8|NZ -41.0 174.0|KZ 48.0 67.0|GE 42.3 43.4|AM 40.1 45.0|CY 35.1 33.4|MT 35.9 14.4
`;

interface Entry { name: string; cc: string; lat: number; lon: number; code: string; metro?: string }
const byName = new Map<string, Entry[]>();
for (const line of CITIES.trim().split('\n')) {
  const [name, cc, lat, lon, code, aliases, metro] = line.split('|');
  const e: Entry = { name, cc, lat: +lat, lon: +lon, code, metro: metro || undefined };
  for (const k of [name, ...(aliases ? aliases.split(',') : [])]) {
    const n = norm(k);
    byName.set(n, [...(byName.get(n) ?? []), e]);
  }
}
const centroids = new Map<string, [number, number]>();
for (const tok of COUNTRIES.trim().split(/[|\n]/)) {
  const [cc, lat, lon] = tok.trim().split(/\s+/);
  if (cc) centroids.set(cc, [+lat, +lon]);
}

function find(n: string, cc: string) {
  const list = byName.get(n);
  if (!list) return undefined;
  return list.find((e) => e.cc === cc) ?? (cc ? undefined : list[0]);
}

const cache = new Map<string, Place>();

/** Resolve a node key like `DE-Frankfurt am Main` to a place on the map */
export function place(key: string): Place {
  const hit = cache.get(key);
  if (hit) return hit;
  const m = /^([A-Za-z]{2})[-_ ](.+)$/.exec(key);
  const cc = m ? m[1].toUpperCase() : '';
  const raw = (m ? m[2] : key).replace(/_/g, ' ').trim();
  const n = norm(raw);
  // Exact name, then progressively shorter prefixes ("frankfurt am main" → "frankfurt"),
  // then any single word that names a city ("equinix ld8 london" → "london")
  let e = find(n, cc);
  const words = n.split(' ');
  for (let k = words.length - 1; !e && k > 0; k--) e = find(words.slice(0, k).join(' '), cc);
  for (const w of words) if (!e && w.length > 3) e = find(w, cc);
  const name = raw.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAm\b/, 'am');
  let p: Place;
  if (e) {
    p = { key, cc, name: e.metro ? raw : e.name.replace(/\b\w/g, (c) => c.toUpperCase()), code: e.code, metro: e.metro, lat: e.lat, lon: e.lon, approx: false };
  } else if (centroids.has(cc)) {
    const [lat, lon] = centroids.get(cc)!;
    p = { key, cc, name, code: norm(raw).slice(0, 3).toUpperCase(), lat, lon, approx: true };
  } else {
    p = { key, cc, name, code: norm(raw).slice(0, 3).toUpperCase(), approx: true };
  }
  cache.set(key, p);
  return p;
}
