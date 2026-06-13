const db = require('../db');

const MILESTONES = [
  { id: 'first-summit', label: 'First Summit', icon: '🥾', threshold: 1 },
  { id: 'ten-club', label: '10 Club', icon: '🏔️', threshold: 10 },
  { id: 'quarter-century', label: '25 Club', icon: '⛰️', threshold: 25 },
  { id: 'half-century', label: '50 Club', icon: '🏆', threshold: 50 },
  { id: 'century', label: '100 Club', icon: '💯', threshold: 100 },
  { id: 'halfway', label: 'Halfway There', icon: '🚩', threshold: 95 },
  { id: 'completionist', label: 'All 189', icon: '👑', threshold: 189 },
];

// Returns the list of badges a user has earned, based on their total
// completed count and full completion of any region's summit set.
function getBadgesForUser(userId) {
  const total = db.prepare('SELECT COUNT(*) AS c FROM completions WHERE user_id = ?').get(userId).c;

  const badges = MILESTONES
    .filter(m => total >= m.threshold)
    .map(m => ({ id: m.id, label: m.label, icon: m.icon }));

  const areaRows = db.prepare(`
    SELECT s.area AS area, COUNT(*) AS total,
           SUM(CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END) AS completed
    FROM summits s
    LEFT JOIN completions c ON c.summit_id = s.id AND c.user_id = ?
    GROUP BY s.area
  `).all(userId);

  for (const row of areaRows) {
    if (row.area && row.total > 0 && row.completed === row.total) {
      badges.push({ id: `region-${row.area}`, label: `${row.area} Complete`, icon: '🎖️' });
    }
  }

  return badges;
}

module.exports = { getBadgesForUser, MILESTONES };
