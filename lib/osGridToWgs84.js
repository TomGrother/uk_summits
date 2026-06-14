// Converts a British National Grid reference (e.g. "NY215072") to WGS84 lat/lng.
// Based on the standard OSGB36 transverse-Mercator projection (Airy 1830 ellipsoid)
// followed by a Helmert transform to WGS84, as published by Ordnance Survey.

const DEG = Math.PI / 180;

function gridRefToEN(gridref) {
  const letters = gridref.slice(0, 2).toUpperCase();
  const digits = gridref.slice(2);
  const half = digits.length / 2;
  const eastingDigits = digits.slice(0, half);
  const northingDigits = digits.slice(half);
  const scale = Math.pow(10, 5 - half);

  let l1 = letters.charCodeAt(0) - 65;
  let l2 = letters.charCodeAt(1) - 65;
  if (l1 > 7) l1--;
  if (l2 > 7) l2--;

  const e100km = ((l1 - 2) % 5) * 5 + (l2 % 5);
  const n100km = (19 - Math.floor(l1 / 5) * 5) - Math.floor(l2 / 5);

  const e = e100km * 100000 + Number(eastingDigits) * scale;
  const n = n100km * 100000 + Number(northingDigits) * scale;
  return { e, n };
}

function osGridToOsgb36LatLon(e, n) {
  const a = 6377563.396, b = 6356256.909;
  const F0 = 0.9996012717;
  const lat0 = 49 * DEG, lon0 = -2 * DEG;
  const N0 = -100000, E0 = 400000;
  const ecc2 = 1 - (b * b) / (a * a);
  const nn = (a - b) / (a + b);

  let lat = lat0;
  let M = 0;
  do {
    lat = (n - N0 - M) / (a * F0) + lat;

    const Ma = b * F0 * (
      (1 + nn + (5 / 4) * nn * nn + (5 / 4) * nn * nn * nn) * (lat - lat0)
      - (3 * nn + 3 * nn * nn + (21 / 8) * nn * nn * nn) * Math.sin(lat - lat0) * Math.cos(lat + lat0)
      + ((15 / 8) * nn * nn + (15 / 8) * nn * nn * nn) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0))
      - (35 / 24) * nn * nn * nn * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0))
    );
    M = Ma;
  } while (Math.abs(n - N0 - M) >= 0.00001);

  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const nu = a * F0 / Math.sqrt(1 - ecc2 * sinLat * sinLat);
  const rho = a * F0 * (1 - ecc2) / Math.pow(1 - ecc2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;

  const tanLat = Math.tan(lat);
  const tan2 = tanLat * tanLat, tan4 = tan2 * tan2, tan6 = tan2 * tan4;
  const secLat = 1 / cosLat;
  const nu3 = nu * nu * nu, nu5 = nu3 * nu * nu, nu7 = nu5 * nu * nu;

  const VII = tanLat / (2 * rho * nu);
  const VIII = (tanLat / (24 * rho * nu3)) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2);
  const IX = (tanLat / (720 * rho * nu5)) * (61 + 90 * tan2 + 45 * tan4);

  const X = secLat / nu;
  const XI = (secLat / (6 * nu3)) * (nu / rho + 2 * tan2);
  const XII = (secLat / (120 * nu5)) * (5 + 28 * tan2 + 24 * tan4);
  const XIIA = (secLat / (5040 * nu7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6);

  const dE = e - E0;
  lat = lat - VII * dE * dE + VIII * Math.pow(dE, 4) - IX * Math.pow(dE, 6);
  const lon = lon0 + X * dE - XI * Math.pow(dE, 3) + XII * Math.pow(dE, 5) - XIIA * Math.pow(dE, 7);

  return { lat: lat / DEG, lon: lon / DEG };
}

function latLonToCartesian(lat, lon, a, b) {
  const sinLat = Math.sin(lat * DEG), cosLat = Math.cos(lat * DEG);
  const sinLon = Math.sin(lon * DEG), cosLon = Math.cos(lon * DEG);
  const e2 = 1 - (b * b) / (a * a);
  const nu = a / Math.sqrt(1 - e2 * sinLat * sinLat);

  return {
    x: nu * cosLat * cosLon,
    y: nu * cosLat * sinLon,
    z: (1 - e2) * nu * sinLat,
  };
}

function osgb36ToWgs84(lat, lon) {
  const aAiry = 6377563.396, bAiry = 6356256.909;
  const aWgs = 6378137, bWgs = 6356752.3142;

  const { x, y, z } = latLonToCartesian(lat, lon, aAiry, bAiry);

  const tx = 446.448, ty = -125.157, tz = 542.060;
  const s = -20.4894 / 1e6;
  const rx = (0.1502 / 3600) * DEG;
  const ry = (0.2470 / 3600) * DEG;
  const rz = (0.8421 / 3600) * DEG;
  const s1 = s + 1;

  const x2 = tx + x * s1 - y * rz + z * ry;
  const y2 = ty + x * rz + y * s1 - z * rx;
  const z2 = tz - x * ry + y * rx + z * s1;

  const e2 = 1 - (bWgs * bWgs) / (aWgs * aWgs);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let lat2 = Math.atan2(z2, p * (1 - e2));
  for (let i = 0; i < 5; i++) {
    const sinLat = Math.sin(lat2);
    const nu = aWgs / Math.sqrt(1 - e2 * sinLat * sinLat);
    lat2 = Math.atan2(z2 + e2 * nu * sinLat, p);
  }
  const lon2 = Math.atan2(y2, x2);

  return { lat: lat2 / DEG, lon: lon2 / DEG };
}

function osGridToWgs84(gridref) {
  const { e, n } = gridRefToEN(gridref);
  const { lat, lon } = osGridToOsgb36LatLon(e, n);
  return osgb36ToWgs84(lat, lon);
}

module.exports = { osGridToWgs84 };
