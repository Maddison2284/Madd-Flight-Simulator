export type Destination = {
  name: string;
  city: string;
  icao: string;
  iata: string;
  lat: number;
  lon: number;
};

export const AIRPORTS: Destination[] = [
  { name: "San Francisco Intl", city: "San Francisco", icao: "KSFO", iata: "SFO", lat: 37.6188, lon: -122.3754 },
  { name: "Los Angeles Intl", city: "Los Angeles", icao: "KLAX", iata: "LAX", lat: 33.9425, lon: -118.408 },
  { name: "San Diego Intl", city: "San Diego", icao: "KSAN", iata: "SAN", lat: 32.7336, lon: -117.1897 },
  { name: "McCarran / Harry Reid", city: "Las Vegas", icao: "KLAS", iata: "LAS", lat: 36.084, lon: -115.1537 },
  { name: "Seattle-Tacoma Intl", city: "Seattle", icao: "KSEA", iata: "SEA", lat: 47.4502, lon: -122.3088 },
  { name: "Portland Intl", city: "Portland", icao: "KPDX", iata: "PDX", lat: 45.5898, lon: -122.5951 },
  { name: "Denver Intl", city: "Denver", icao: "KDEN", iata: "DEN", lat: 39.8561, lon: -104.6737 },
  { name: "Phoenix Sky Harbor", city: "Phoenix", icao: "KPHX", iata: "PHX", lat: 33.4373, lon: -112.0078 },
  { name: "Dallas/Fort Worth", city: "Dallas", icao: "KDFW", iata: "DFW", lat: 32.8998, lon: -97.0403 },
  { name: "Houston Intercontinental", city: "Houston", icao: "KIAH", iata: "IAH", lat: 29.9902, lon: -95.3368 },
  { name: "Hartsfield-Jackson", city: "Atlanta", icao: "KATL", iata: "ATL", lat: 33.6407, lon: -84.4277 },
  { name: "Miami Intl", city: "Miami", icao: "KMIA", iata: "MIA", lat: 25.7959, lon: -80.287 },
  { name: "Orlando Intl", city: "Orlando", icao: "KMCO", iata: "MCO", lat: 28.4312, lon: -81.3081 },
  { name: "O'Hare Intl", city: "Chicago", icao: "KORD", iata: "ORD", lat: 41.9742, lon: -87.9073 },
  { name: "John F. Kennedy Intl", city: "New York", icao: "KJFK", iata: "JFK", lat: 40.6413, lon: -73.7781 },
  { name: "Newark Liberty", city: "Newark", icao: "KEWR", iata: "EWR", lat: 40.6895, lon: -74.1745 },
  { name: "Logan Intl", city: "Boston", icao: "KBOS", iata: "BOS", lat: 42.3656, lon: -71.0096 },
  { name: "Washington Dulles", city: "Washington", icao: "KIAD", iata: "IAD", lat: 38.9531, lon: -77.4565 },
  { name: "Heathrow", city: "London", icao: "EGLL", iata: "LHR", lat: 51.47, lon: -0.4543 },
  { name: "Charles de Gaulle", city: "Paris", icao: "LFPG", iata: "CDG", lat: 49.0097, lon: 2.5479 },
  { name: "Amsterdam Schiphol", city: "Amsterdam", icao: "EHAM", iata: "AMS", lat: 52.3105, lon: 4.7683 },
  { name: "Frankfurt Main", city: "Frankfurt", icao: "EDDF", iata: "FRA", lat: 50.0379, lon: 8.5622 },
  { name: "Dubai Intl", city: "Dubai", icao: "OMDB", iata: "DXB", lat: 25.2532, lon: 55.3657 },
  { name: "Tokyo Haneda", city: "Tokyo", icao: "RJTT", iata: "HND", lat: 35.5494, lon: 139.7798 },
  { name: "Narita Intl", city: "Tokyo", icao: "RJAA", iata: "NRT", lat: 35.772, lon: 140.3929 },
  { name: "Singapore Changi", city: "Singapore", icao: "WSSS", iata: "SIN", lat: 1.3644, lon: 103.9915 },
  { name: "Hong Kong Intl", city: "Hong Kong", icao: "VHHH", iata: "HKG", lat: 22.308, lon: 113.9185 },
  { name: "Sydney Kingsford Smith", city: "Sydney", icao: "YSSY", iata: "SYD", lat: -33.9399, lon: 151.1753 },
  { name: "Honolulu Intl", city: "Honolulu", icao: "PHNL", iata: "HNL", lat: 21.3187, lon: -157.9225 },
  { name: "Mexico City Intl", city: "Mexico City", icao: "MMMX", iata: "MEX", lat: 19.4363, lon: -99.0721 },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function searchAirports(query: string, limit = 8): Destination[] {
  const q = normalize(query);
  if (!q) return AIRPORTS.slice(0, limit);
  const scored = AIRPORTS.map((airport) => {
    const hay = `${airport.iata} ${airport.icao} ${airport.name} ${airport.city}`.toLowerCase();
    let score = 0;
    if (airport.iata.toLowerCase() === q || airport.icao.toLowerCase() === q) score = 100;
    else if (airport.iata.toLowerCase().startsWith(q) || airport.city.toLowerCase().startsWith(q)) score = 80;
    else if (hay.includes(q)) score = 40;
    return { airport, score };
  })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((row) => row.airport);
}

export function formatAirport(airport: Destination): string {
  return `${airport.iata} · ${airport.city}`;
}
