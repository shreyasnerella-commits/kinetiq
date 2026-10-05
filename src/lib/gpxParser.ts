// Haversine formula to compute distance in KM between 2 GPS coordinates
function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in KM
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface ParsedGpxData {
  distanceKm: number;
  durationMin: number;
  startTime: string;
}

export function parseGpxXml(xmlText: string): ParsedGpxData {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");

  const trkpts = xmlDoc.getElementsByTagName("trkpt");
  if (!trkpts || trkpts.length < 2) {
    throw new Error("Invalid GPX file: Found fewer than 2 GPS trackpoints.");
  }

  let totalDistanceKm = 0;
  let firstTime: Date | null = null;
  let lastTime: Date | null = null;

  for (let i = 0; i < trkpts.length; i++) {
    const pt = trkpts[i];
    const lat = parseFloat(pt.getAttribute("lat") || "0");
    const lon = parseFloat(pt.getAttribute("lon") || "0");

    const timeElem = pt.getElementsByTagName("time")[0];
    if (timeElem && timeElem.textContent) {
      const ptTime = new Date(timeElem.textContent);
      if (!firstTime) firstTime = ptTime;
      lastTime = ptTime;
    }

    if (i > 0) {
      const prevPt = trkpts[i - 1];
      const prevLat = parseFloat(prevPt.getAttribute("lat") || "0");
      const prevLon = parseFloat(prevPt.getAttribute("lon") || "0");
      totalDistanceKm += haversineDistanceKm(prevLat, prevLon, lat, lon);
    }
  }

  let durationMin = 0;
  if (firstTime && lastTime) {
    durationMin = Math.round((lastTime.getTime() - firstTime.getTime()) / 60000);
  }

  return {
    distanceKm: parseFloat(totalDistanceKm.toFixed(2)),
    durationMin: Math.max(1, durationMin),
    startTime: firstTime ? firstTime.toISOString() : new Date().toISOString(),
  };
}