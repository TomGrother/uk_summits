const coordsById = require('./snowdonRouteCoords.json');

// Pilot dataset: walking routes up Snowdon, sourced from OpenStreetMap
// (route=hiking relations), licensed under ODbL (c) OpenStreetMap contributors.
const ROUTES = [
  {
    osm_id: '4004181',
    name: 'Llanberis Path',
    distance_km: 6.0,
    ascent_m: 950,
    difficulty: 'Easy',
    description: "The longest but gentlest route to the summit, following the route of the Snowdon Mountain Railway from Llanberis. Wide, well-maintained path throughout — a good choice for less experienced walkers.",
  },
  {
    osm_id: '4004199',
    name: 'Rhyd Ddu Path',
    distance_km: 5.6,
    ascent_m: 900,
    difficulty: 'Moderate',
    description: "A quieter route from the west, with a gradual lower section followed by a steeper, narrower ridge near the top. Good views over Cwm Du and Nantlle.",
  },
  {
    osm_id: '4004200',
    name: 'Snowdon Ranger Path',
    distance_km: 5.8,
    ascent_m: 950,
    difficulty: 'Moderate',
    description: "Said to be the oldest route up Snowdon, starting at the Snowdon Ranger youth hostel on the shore of Llyn Cwellyn. Steady, consistent gradient.",
  },
  {
    osm_id: '4004182',
    name: 'Pyg Track',
    distance_km: 4.8,
    ascent_m: 700,
    difficulty: 'Moderate',
    description: "One of the most popular routes, starting from Pen-y-Pass. Steep and rocky in places with some scrambling near the top, but shorter than the Miners' Track.",
  },
  {
    osm_id: '4004180',
    name: "Miners' Track",
    distance_km: 5.3,
    ascent_m: 720,
    difficulty: 'Moderate',
    description: "Also from Pen-y-Pass, this route is flat and easy past the lakes of Llyn Llydaw and Glaslyn before climbing steeply to join the Pyg Track for the final ascent.",
  },
  {
    osm_id: '4004198',
    name: 'Watkin Path',
    distance_km: 4.4,
    ascent_m: 1000,
    difficulty: 'Hard',
    description: "The route with the greatest height gain, starting from near sea level at Nant Gwynant. A beautiful but relentless climb, finishing with a steep scree slope to the summit.",
  },
  {
    osm_id: '4499076',
    name: 'Crib Goch',
    distance_km: 1.3,
    ascent_m: 850,
    difficulty: 'Severe',
    description: "An exposed, narrow knife-edge ridge scramble — not a route for beginners or anyone uncomfortable with heights. Usually combined with the Pyg Track to form the classic Snowdon Horseshoe.",
  },
];

function snowdonRoutes() {
  return ROUTES.map(r => ({
    name: r.name,
    distance_km: r.distance_km,
    ascent_m: r.ascent_m,
    difficulty: r.difficulty,
    description: r.description,
    source: 'OpenStreetMap contributors (ODbL)',
    geojson: JSON.stringify({
      type: 'LineString',
      coordinates: coordsById[r.osm_id],
    }),
  }));
}

module.exports = { snowdonRoutes };
