const db = require('../db');

// Milestones are computed against the current summit count so they stay
// correct as more regions/summits are added.
function getMilestones() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM summits').get().c;
  return [
    { id: 'first-summit', label: 'First Summit', icon: '🥾', threshold: 1 },
    { id: 'ten-club', label: '10 Club', icon: '🏔️', threshold: 10 },
    { id: 'quarter-century', label: '25 Club', icon: '⛰️', threshold: 25 },
    { id: 'half-century', label: '50 Club', icon: '🏆', threshold: 50 },
    { id: 'century', label: '100 Club', icon: '💯', threshold: 100 },
    { id: 'double-century', label: '200 Club', icon: '🌟', threshold: 200 },
    { id: 'halfway', label: 'Halfway There', icon: '🚩', threshold: Math.round(total / 2) },
    { id: 'completionist', label: `All ${total}`, icon: '👑', threshold: total },
  ];
}

// Returns the list of badges a user has earned, based on their total
// completed count and full completion of any region's summit set.
function getBadgesForUser(userId) {
  const total = db.prepare('SELECT COUNT(*) AS c FROM completions WHERE user_id = ?').get(userId).c;

  const badges = getMilestones()
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

// Returns every badge that exists (earned or not), each flagged with `earned`
// and, for milestones, the user's current progress toward the threshold.
function getAllBadgesForUser(userId) {
  const total = db.prepare('SELECT COUNT(*) AS c FROM completions WHERE user_id = ?').get(userId).c;

  const milestoneBadges = getMilestones().map(m => ({
    id: m.id,
    label: m.label,
    icon: m.icon,
    earned: total >= m.threshold,
    progress: total,
    target: m.threshold,
  }));

  const areaRows = db.prepare(`
    SELECT s.area AS area, COUNT(*) AS total,
           SUM(CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END) AS completed
    FROM summits s
    LEFT JOIN completions c ON c.summit_id = s.id AND c.user_id = ?
    GROUP BY s.area
    ORDER BY s.area
  `).all(userId);

  const areaBadges = areaRows
    .filter(row => row.area)
    .map(row => ({
      id: `region-${row.area}`,
      label: `${row.area} Complete`,
      icon: '🎖️',
      earned: row.total > 0 && row.completed === row.total,
      progress: row.completed,
      target: row.total,
    }));

  return [...milestoneBadges, ...areaBadges];
}

module.exports = { getBadgesForUser, getAllBadgesForUser, getMilestones };
