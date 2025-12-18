// NHL Team Primary Colors
export const TEAM_COLORS: Record<string, string> = {
  'ANA': '#B9975B', // Anaheim Ducks - Gold
  'ARI': '#8C2633', // Arizona Coyotes - Brick Red
  'BOS': '#FFB81C', // Boston Bruins - Gold
  'BUF': '#003087', // Buffalo Sabres - Navy Blue
  'CGY': '#C8102E', // Calgary Flames - Red
  'CAR': '#CC0000', // Carolina Hurricanes - Red
  'CHI': '#C8102E', // Chicago Blackhawks - Red
  'COL': '#6F263D', // Colorado Avalanche - Burgundy
  'CBJ': '#002654', // Columbus Blue Jackets - Blue
  'DAL': '#006847', // Dallas Stars - Green
  'DET': '#C8102E', // Detroit Red Wings - Red
  'EDM': '#FF4C00', // Edmonton Oilers - Orange
  'FLA': '#C8102E', // Florida Panthers - Red
  'LAK': '#111111', // Los Angeles Kings - Black
  'MIN': '#154734', // Minnesota Wild - Green
  'MTL': '#AF1E2D', // Montreal Canadiens - Red
  'NSH': '#FFB81C', // Nashville Predators - Gold
  'NJD': '#CE1126', // New Jersey Devils - Red
  'NYI': '#00539B', // New York Islanders - Blue
  'NYR': '#0033A0', // New York Rangers - Blue
  'OTT': '#C8102E', // Ottawa Senators - Red
  'PHI': '#F74902', // Philadelphia Flyers - Orange
  'PIT': '#FFB81C', // Pittsburgh Penguins - Gold
  'SJS': '#006D75', // San Jose Sharks - Teal
  'SEA': '#001628', // Seattle Kraken - Navy
  'STL': '#002F87', // St. Louis Blues - Blue
  'TBL': '#002868', // Tampa Bay Lightning - Blue
  'TOR': '#003E7E', // Toronto Maple Leafs - Blue
  'UTA': '#B30838', // Utah Hockey Club - Red
  'VAN': '#001F5B', // Vancouver Canucks - Blue
  'VGK': '#B4975A', // Vegas Golden Knights - Gold
  'WSH': '#C8102E', // Washington Capitals - Red
  'WPG': '#041E42', // Winnipeg Jets - Navy
};

export const getTeamColor = (teamAbbreviation: string): string => {
  const abbrev = teamAbbreviation?.toUpperCase() || '';
  return TEAM_COLORS[abbrev] || '#666666'; // Default gray if team not found
};

