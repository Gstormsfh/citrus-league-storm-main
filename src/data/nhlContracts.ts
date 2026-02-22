// src/data/nhlContracts.ts
// NHL 2025-26 Salary Cap Contract Data for all 32 teams
// Source: CapWages.com
// Auto-generated from public salary cap data

import { type PlayerContract, type ContractStatus, type ClauseType, getPositionGroup } from '@/types/captracker';

// Calculate age from birthDate string (YYYY-MM-DD)
function calcAge(birthDate: string): number {
  const birth = new Date(birthDate);
  if (isNaN(birth.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// Compact helper to create PlayerContract from minimal data
function c(
  name: string,
  position: string,
  team: string,
  capHit: number,
  totalYears: number,
  yearsRemaining: number,
  expiryYear: number,
  expiryStatus: ContractStatus,
  rosterStatus: PlayerContract['rosterStatus'] = 'NHL',
  clause: ClauseType = null,
  birthDate: string = '',
): PlayerContract {
  return {
    playerId: 0,
    name,
    position,
    positionGroup: getPositionGroup(position),
    jerseyNumber: 0,
    age: birthDate ? calcAge(birthDate) : 0,
    birthDate: birthDate || undefined,
    team,
    capHit,
    aav: capHit,
    baseSalary: capHit,
    signingBonus: 0,
    totalSalary: capHit,
    contractYears: totalYears,
    yearsRemaining,
    expiryYear,
    expiryStatus,
    clause,
    rosterStatus,
    isWaiverExempt: false,
  };
}

export const NHL_CONTRACT_DATA: Record<string, PlayerContract[]> = {
  // ============================================================
  // BOS - Boston Bruins
  // ============================================================
  'BOS': [
    // Forwards
    c('David Pastrnak', 'RW', 'BOS', 11_250_000, 8, 6, 2031, 'UFA', 'NHL', 'NMC', '1996-05-25'),
    c('Elias Lindholm', 'C', 'BOS', 7_750_000, 7, 6, 2031, 'UFA', 'NHL', 'NMC', '1994-12-02'),
    c('Casey Mittelstadt', 'C', 'BOS', 5_750_000, 3, 2, 2027, 'UFA', 'NHL', null, '1998-11-22'),
    c('Morgan Geekie', 'C', 'BOS', 5_500_000, 6, 6, 2031, 'UFA', 'NHL', null, '1998-07-20'),
    c('Pavel Zacha', 'C', 'BOS', 4_750_000, 3, 2, 2027, 'UFA', 'NHL', null, '1997-04-06'),
    c('Viktor Arvidsson', 'LW', 'BOS', 4_000_000, 2, 1, 2026, 'UFA', 'NHL', null, '1993-04-08'),
    c('Tanner Jeannot', 'LW', 'BOS', 3_400_000, 5, 5, 2030, 'UFA', 'NHL', null, '1997-05-29'),
    c('Sean Kuraly', 'C', 'BOS', 1_850_000, 2, 2, 2027, 'UFA', 'NHL', null, '1993-01-20'),
    c('Mark Kastelic', 'RW', 'BOS', 1_566_667, 3, 3, 2028, 'UFA', 'NHL', null, '1999-03-11'),
    c('Michael Eyssimont', 'C', 'BOS', 1_450_000, 2, 2, 2027, 'UFA', 'NHL', null, '1996-09-09'),
    c('Alex Steeves', 'C', 'BOS', 1_625_000, 3, 3, 2028, 'UFA', 'NHL', null, '1999-12-10'),
    c('Marat Khusnutdinov', 'C', 'BOS', 925_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-07-17'),
    c('Fraser Minten', 'C', 'BOS', 816_667, 3, 2, 2027, 'RFA', 'NHL', null, '2004-07-05'),
    // AHL Forwards
    c('Dalton Bancroft', 'RW', 'BOS', 950_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Matej Blumel', 'RW', 'BOS', 875_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Matthew Poitras', 'C', 'BOS', 870_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Riley Duran', 'C', 'BOS', 867_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Fabian Lysell', 'RW', 'BOS', 863_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Dans Locmelis', 'C', 'BOS', 860_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Brett Harrison', 'C', 'BOS', 836_667, 2, 1, 2026, 'RFA', 'AHL', null),
    c('John Farinacci', 'C', 'BOS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Patrick Brown', 'C', 'BOS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Georgii Merkulov', 'C', 'BOS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Riley Tufte', 'LW', 'BOS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Defensemen
    c('Charlie McAvoy', 'D', 'BOS', 9_500_000, 6, 5, 2030, 'UFA', 'NHL', 'NMC'),
    c('Hampus Lindholm', 'D', 'BOS', 6_500_000, 6, 5, 2030, 'UFA', 'NHL', 'NMC', '1994-01-20'),
    c('Nikita Zadorov', 'D', 'BOS', 5_000_000, 6, 5, 2030, 'UFA', 'NHL', null, '1995-04-16'),
    c('Mason Lohrei', 'D', 'BOS', 3_200_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-01-17'),
    c('Henri Jokiharju', 'D', 'BOS', 3_000_000, 3, 3, 2028, 'UFA', 'NHL', null, '1999-06-17'),
    c('Andrew Peeke', 'D', 'BOS', 2_750_000, 2, 1, 2026, 'UFA', 'NHL', null, '1998-03-17'),
    c('Jordan Harris', 'D', 'BOS', 825_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-07-07'),
    c('Jonathan Aspirot', 'D', 'BOS', 775_000, 3, 3, 2028, 'UFA', 'NHL', null, '1999-05-16'),
    // AHL Defensemen
    c('Frederic Brunet', 'D', 'BOS', 860_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Jackson Edward', 'D', 'BOS', 831_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Loke Johansson', 'D', 'BOS', 831_667, 4, 4, 2029, 'RFA', 'AHL', null),
    c('Maximus Wanner', 'D', 'BOS', 828_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Victor Soderstrom', 'D', 'BOS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Michael Callahan', 'D', 'BOS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Billy Sweezey', 'D', 'BOS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Goalies
    c('Jeremy Swayman', 'G', 'BOS', 8_250_000, 8, 7, 2032, 'UFA', 'NHL', null, '1998-11-24'),
    c('Joonas Korpisalo', 'G', 'BOS', 3_000_000, 4, 3, 2028, 'UFA', 'NHL', null, '1994-04-28'),
    c('Michael DiPietro', 'G', 'BOS', 812_500, 2, 2, 2027, 'UFA', 'NHL', null),
    // AHL Goalies
    c('Simon Zajicek', 'G', 'BOS', 872_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Luke Cavallin', 'G', 'BOS', 790_000, 1, 1, 2026, 'RFA', 'AHL', null),
  ],

  // ============================================================
  // BUF - Buffalo Sabres
  // ============================================================
  'BUF': [
    // Forwards
    c('Josh Norris', 'C', 'BUF', 7_950_000, 5, 5, 2030, 'UFA', 'IR', null, '1999-05-05'),
    c('Tage Thompson', 'C', 'BUF', 7_142_857, 5, 5, 2030, 'UFA', 'NHL', null, '1997-10-30'),
    c('Josh Doan', 'RW', 'BUF', 6_950_000, 8, 8, 2033, 'UFA', 'NHL', null, '2002-02-01'),
    c('Ryan McLeod', 'C', 'BUF', 5_000_000, 4, 4, 2029, 'UFA', 'NHL', null, '1999-09-21'),
    c('Alex Tuch', 'RW', 'BUF', 4_750_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-05-10'),
    c('Jason Zucker', 'LW', 'BUF', 4_750_000, 2, 2, 2027, 'UFA', 'NHL', null, '1992-01-16'),
    c('Jordan Greenway', 'LW', 'BUF', 4_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1997-02-16'),
    c('Jack Quinn', 'RW', 'BUF', 3_375_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-09-19'),
    c('Justin Danforth', 'RW', 'BUF', 1_800_000, 2, 2, 2027, 'UFA', 'IR', null, '1993-03-15'),
    c('Peyton Krebs', 'C', 'BUF', 1_450_000, 1, 1, 2026, 'RFA', 'NHL', null, '2001-01-26'),
    c('Beck Malenstyn', 'RW', 'BUF', 1_350_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-02-04'),
    c('Zach Benson', 'LW', 'BUF', 950_000, 1, 1, 2026, 'RFA', 'NHL', null, '2005-05-12'),
    c('Jiri Kulich', 'C', 'BUF', 886_667, 2, 2, 2027, 'RFA', 'IR', null, '2004-04-14'),
    c('Noah Ostlund', 'C', 'BUF', 886_667, 2, 2, 2027, 'RFA', 'NHL', null, '2004-03-11'),
    c('Tyson Kozak', 'C', 'BUF', 775_000, 3, 3, 2028, 'RFA', 'NHL', null, '2002-12-29'),
    c('Josh Dunne', 'LW', 'BUF', 775_000, 1, 1, 2026, 'UFA', 'IR', null, '1998-12-08'),
    // Defensemen
    c('Rasmus Dahlin', 'D', 'BUF', 11_000_000, 7, 7, 2032, 'UFA', 'NHL', 'NMC', '2000-04-13'),
    c('Owen Power', 'D', 'BUF', 8_350_000, 6, 6, 2031, 'UFA', 'NHL', null, '2002-11-22'),
    c('Bowen Byram', 'D', 'BUF', 6_250_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-06-13'),
    c('Mattias Samuelsson', 'D', 'BUF', 4_285_714, 5, 5, 2030, 'UFA', 'NHL', null, '2000-03-14'),
    c('Conor Timmins', 'D', 'BUF', 2_200_000, 2, 2, 2027, 'UFA', 'IR', null, '1998-09-18'),
    c('Michael Kesselring', 'D', 'BUF', 1_400_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-01-13'),
    c('Jacob Bryson', 'D', 'BUF', 900_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-11-18'),
    // Goalies
    c('Ukko-Pekka Luukkonen', 'G', 'BUF', 4_750_000, 4, 4, 2029, 'UFA', 'IR', null, '1999-03-09'),
    c('Alex Lyon', 'G', 'BUF', 1_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1992-12-09'),
    c('Colten Ellis', 'G', 'BUF', 775_000, 2, 2, 2027, 'RFA', 'NHL', null, '2000-10-05'),
  ],

  // ============================================================
  // DET - Detroit Red Wings
  // ============================================================
  'DET': [
    // Forwards
    c('Dylan Larkin', 'C', 'DET', 8_700_000, 8, 6, 2031, 'UFA', 'NHL', 'NMC', '1996-07-30'),
    c('Lucas Raymond', 'RW', 'DET', 8_075_000, 8, 7, 2032, 'UFA', 'NHL', null, '2002-03-28'),
    c('Alex DeBrincat', 'LW', 'DET', 7_875_000, 3, 2, 2027, 'UFA', 'NHL', null, '1997-12-18'),
    c('Andrew Copp', 'C', 'DET', 5_625_000, 3, 2, 2027, 'UFA', 'NHL', null, '1994-07-08'),
    c('J.T. Compher', 'C', 'DET', 5_100_000, 4, 3, 2028, 'UFA', 'NHL', null, '1995-04-08'),
    c('Michael Rasmussen', 'C', 'DET', 3_200_000, 4, 3, 2028, 'UFA', 'NHL', null, '1999-04-17'),
    c('Patrick Kane', 'RW', 'DET', 3_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1988-11-19'),
    c('Mason Appleton', 'RW', 'DET', 2_900_000, 2, 2, 2027, 'UFA', 'NHL', null, '1996-01-15'),
    c('Elmer Soderblom', 'LW', 'DET', 1_125_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-07-05'),
    c('James van Riemsdyk', 'RW', 'DET', 1_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1989-05-04'),
    c('Marco Kasper', 'LW', 'DET', 886_667, 3, 2, 2027, 'RFA', 'NHL', null, '2004-04-08'),
    c('Emmitt Finnie', 'LW', 'DET', 821_667, 4, 3, 2028, 'RFA', 'NHL', null, '2005-06-27'),
    // AHL Forwards
    c('Sheldon Dries', 'C', 'DET', 775_000, 3, 3, 2028, 'UFA', 'AHL', null),
    c('Carter Bear', 'LW', 'DET', 975_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Michael Brandsegg-Nygard', 'RW', 'DET', 942_500, 4, 3, 2028, 'RFA', 'AHL', null),
    c('Jesse Kiiskinen', 'RW', 'DET', 923_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Carter Mazur', 'LW', 'DET', 905_833, 2, 1, 2026, 'RFA', 'AHL', null),
    c('Nate Danielson', 'C', 'DET', 886_667, 4, 3, 2028, 'RFA', 'AHL', null),
    c('Alexandre Doucet', 'LW', 'DET', 870_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Jakub Rychlovsky', 'LW', 'DET', 870_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Ondrej Becher', 'C', 'DET', 865_000, 3, 2, 2027, 'RFA', 'AHL', null),
    c('Amadeus Lombardi', 'C', 'DET', 838_333, 2, 1, 2026, 'RFA', 'AHL', null),
    c('Eduards Tralmaks', 'RW', 'DET', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Austin Watson', 'LW', 'DET', 775_000, 2, 1, 2026, 'UFA', 'AHL', null),
    c('John Leonard', 'RW', 'DET', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Dominik Shine', 'RW', 'DET', 775_000, 3, 2, 2027, 'UFA', 'AHL', null),
    // Defensemen
    c('Moritz Seider', 'D', 'DET', 8_550_000, 7, 6, 2031, 'UFA', 'NHL', null, '2001-04-06'),
    c('Ben Chiarot', 'D', 'DET', 4_750_000, 4, 4, 2029, 'UFA', 'NHL', null, '1991-05-09'),
    c('Erik Gustafsson', 'D', 'DET', 2_000_000, 2, 1, 2026, 'UFA', 'NHL', null, '1992-03-14'),
    c('Albert Johansson', 'D', 'DET', 1_125_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-01-04'),
    c('Travis Hamonic', 'D', 'DET', 1_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1990-08-16'),
    c('Axel Sandin-Pellikka', 'D', 'DET', 918_333, 4, 3, 2028, 'RFA', 'NHL', null, '2005-03-11'),
    c('Simon Edvinsson', 'D', 'DET', 894_167, 2, 1, 2026, 'RFA', 'IR', null, '2003-02-05'),
    c('Jacob Bernard-Docker', 'D', 'DET', 875_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-06-30'),
    // AHL Defensemen
    c('Justin Holl', 'D', 'DET', 3_400_000, 2, 1, 2026, 'UFA', 'AHL', null),
    c('William Wallinder', 'D', 'DET', 925_000, 2, 1, 2026, 'RFA', 'AHL', null),
    c('Shai Buium', 'D', 'DET', 925_000, 3, 2, 2027, 'RFA', 'AHL', null),
    c('Anton Johansson', 'D', 'DET', 870_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Antti Tuomisto', 'D', 'DET', 813_750, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Ian Mitchell', 'D', 'DET', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('William Lagesson', 'D', 'DET', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Eemil Viro', 'D', 'DET', 828_333, 1, 1, 2026, 'RFA', 'AHL', null),
    // Goalies
    c('John Gibson', 'G', 'DET', 6_400_000, 3, 2, 2027, 'UFA', 'NHL', null, '1993-07-14'),
    c('Cam Talbot', 'G', 'DET', 2_500_000, 2, 1, 2026, 'UFA', 'NHL', null, '1987-07-05'),
    // AHL Goalies
    c('Michal Postava', 'G', 'DET', 975_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Sebastian Cossa', 'G', 'DET', 863_333, 2, 1, 2026, 'RFA', 'AHL', null),
    c('Carter Gylander', 'G', 'DET', 855_000, 2, 1, 2026, 'RFA', 'AHL', null),
  ],

  // ============================================================
  // FLA - Florida Panthers
  // ============================================================
  'FLA': [
    // Forwards
    c('Aleksander Barkov', 'C', 'FLA', 10_000_000, 5, 5, 2030, 'UFA', 'LTIR', 'NMC', '1995-09-02'),
    c('Matthew Tkachuk', 'RW', 'FLA', 9_500_000, 5, 5, 2030, 'UFA', 'NHL', 'NMC', '1997-12-11'),
    c('Sam Reinhart', 'RW', 'FLA', 8_625_000, 7, 7, 2032, 'UFA', 'NHL', null, '1995-11-06'),
    c('Sam Bennett', 'C', 'FLA', 8_000_000, 8, 8, 2033, 'UFA', 'NHL', null, '1996-06-20'),
    c('Carter Verhaeghe', 'LW', 'FLA', 7_000_000, 8, 8, 2033, 'UFA', 'NHL', null, '1995-08-14'),
    c('Brad Marchand', 'RW', 'FLA', 5_250_000, 6, 6, 2031, 'UFA', 'NHL', null, '1988-05-11'),
    c('Anton Lundell', 'C', 'FLA', 5_000_000, 5, 5, 2030, 'UFA', 'NHL', null, '2001-10-03'),
    c('Evan Rodrigues', 'C', 'FLA', 3_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1993-07-28'),
    c('Eetu Luostarinen', 'LW', 'FLA', 3_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-09-02'),
    c('Jesper Boqvist', 'LW', 'FLA', 1_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-10-30'),
    c('Sandis Vilmanis', 'LW', 'FLA', 855_000, 2, 2, 2027, 'RFA', 'NHL', null, '2004-01-23'),
    c('A.J. Greer', 'RW', 'FLA', 850_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-12-14'),
    c('Cole Schwindt', 'C', 'FLA', 825_000, 1, 1, 2026, 'UFA', 'NHL', null, '2001-04-25'),
    c('Jonah Gadjovich', 'RW', 'FLA', 775_000, 3, 3, 2028, 'UFA', 'IR', null, '1998-10-12'),
    c('Mackie Samoskevich', 'LW', 'FLA', 775_000, 1, 1, 2026, 'RFA', 'NHL', null, '2002-11-15'),
    c('Luke Kunin', 'C', 'FLA', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-12-04'),
    c('Tomas Nosek', 'LW', 'FLA', 775_000, 1, 1, 2026, 'UFA', 'LTIR', null),
    // AHL Forwards
    c('Ben Steeves', 'LW', 'FLA', 950_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Jack Devine', 'RW', 'FLA', 950_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Gracyn Sawchyn', 'C', 'FLA', 846_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Hunter St. Martin', 'LW', 'FLA', 828_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Kai Schwindt', 'LW', 'FLA', 798_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('MacKenzie Entwistle', 'RW', 'FLA', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Nolan Foote', 'LW', 'FLA', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Wilmer Skoog', 'C', 'FLA', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Noah Gregor', 'LW', 'FLA', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Jack Studnicka', 'RW', 'FLA', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Defensemen
    c('Seth Jones', 'D', 'FLA', 9_500_000, 5, 5, 2030, 'UFA', 'LTIR', 'NMC', '1994-10-03'),
    c('Aaron Ekblad', 'D', 'FLA', 6_100_000, 8, 8, 2033, 'UFA', 'NHL', 'NMC', '1996-02-07'),
    c('Gustav Forsling', 'D', 'FLA', 5_750_000, 7, 7, 2032, 'UFA', 'NHL', null, '1996-06-12'),
    c('Niko Mikkola', 'D', 'FLA', 5_000_000, 9, 9, 2034, 'UFA', 'NHL', null, '1996-04-27'),
    c('Dmitry Kulikov', 'D', 'FLA', 1_150_000, 3, 3, 2028, 'UFA', 'LTIR', null, '1990-10-29'),
    c('Uvis Balinskis', 'D', 'FLA', 875_000, 3, 3, 2028, 'UFA', 'NHL', null, '1996-08-01'),
    c('Jeff Petry', 'D', 'FLA', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1987-12-09'),
    c('Donovan Sebrango', 'D', 'FLA', 775_000, 1, 1, 2026, 'RFA', 'NHL', null, '2002-01-12'),
    c('Tobias Bjornfot', 'D', 'FLA', 775_000, 1, 1, 2026, 'RFA', 'IR', null, '2001-04-06'),
    // AHL Defensemen
    c('Mikulas Hovorka', 'D', 'FLA', 950_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Marek Alscher', 'D', 'FLA', 865_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Evan Nause', 'D', 'FLA', 864_167, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Ludvig Jansson', 'D', 'FLA', 855_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Mike Benning', 'D', 'FLA', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    // Goalies
    c('Sergei Bobrovsky', 'G', 'FLA', 10_000_000, 1, 1, 2026, 'UFA', 'NHL', 'NMC', '1988-09-20'),
    c('Daniil Tarasov', 'G', 'FLA', 1_050_000, 1, 1, 2026, 'UFA', 'NHL', null, '1999-03-27'),
    // AHL Goalies
    c('Cooper Black', 'G', 'FLA', 950_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Kirill Gerasimyuk', 'G', 'FLA', 875_000, 2, 2, 2027, 'RFA', 'AHL', null),
  ],

  // ============================================================
  // MTL - Montreal Canadiens
  // ============================================================
  'MTL': [
    // Forwards
    c('Patrik Laine', 'LW', 'MTL', 8_700_000, 1, 1, 2026, 'UFA', 'IR', null, '1998-04-19'),
    c('Nick Suzuki', 'C', 'MTL', 7_875_000, 5, 5, 2030, 'UFA', 'NHL', 'NMC', '1999-08-10'),
    c('Cole Caufield', 'RW', 'MTL', 7_850_000, 6, 6, 2031, 'UFA', 'NHL', null, '2001-01-02'),
    c('Juraj Slafkovsky', 'LW', 'MTL', 7_600_000, 8, 8, 2033, 'UFA', 'NHL', null, '2004-03-30'),
    c('Brendan Gallagher', 'RW', 'MTL', 6_500_000, 2, 2, 2027, 'UFA', 'NHL', 'NMC', '1992-05-06'),
    c('Josh Anderson', 'RW', 'MTL', 5_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1994-05-07'),
    c('Phillip Danault', 'C', 'MTL', 5_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1993-02-24'),
    c('Kirby Dach', 'C', 'MTL', 3_362_500, 1, 1, 2026, 'RFA', 'NHL', null, '2001-01-21'),
    c('Alex Newhook', 'LW', 'MTL', 2_900_000, 2, 2, 2027, 'RFA', 'IR', null, '2001-01-28'),
    c('Jake Evans', 'C', 'MTL', 2_850_000, 4, 4, 2029, 'UFA', 'NHL', null, '1996-06-02'),
    c('Alexandre Texier', 'RW', 'MTL', 1_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1999-09-13'),
    c('Ivan Demidov', 'RW', 'MTL', 940_833, 2, 2, 2027, 'RFA', 'NHL', null, '2005-12-10'),
    c('Oliver Kapanen', 'C', 'MTL', 925_000, 2, 2, 2027, 'RFA', 'NHL', null, '2003-07-29'),
    c('Joe Veleno', 'C', 'MTL', 900_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-01-13'),
    c('Zack Bolduc', 'LW', 'MTL', 863_333, 1, 1, 2026, 'RFA', 'NHL', null),
    // AHL Forwards
    c('Vinzenz Rohrer', 'C', 'MTL', 950_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Luke Tuch', 'LW', 'MTL', 912_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Filip Mesar', 'RW', 'MTL', 886_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Tyler Thorpe', 'RW', 'MTL', 868_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Florian Xhekaj', 'LW', 'MTL', 866_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Jared Davidson', 'LW', 'MTL', 862_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Owen Beck', 'RW', 'MTL', 853_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Riley Kidney', 'C', 'MTL', 836_667, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Joshua Roy', 'LW', 'MTL', 835_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Alex Belzile', 'RW', 'MTL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Lucas Condotta', 'LW', 'MTL', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Sean Farrell', 'C', 'MTL', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Sammy Blais', 'LW', 'MTL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Defensemen
    c('Noah Dobson', 'D', 'MTL', 9_500_000, 8, 8, 2033, 'UFA', 'NHL', null, '2000-01-07'),
    c('Kaiden Guhle', 'D', 'MTL', 5_550_000, 6, 6, 2031, 'UFA', 'NHL', null, '2002-01-18'),
    c('Mike Matheson', 'D', 'MTL', 4_875_000, 6, 6, 2031, 'UFA', 'NHL', 'M-NTC', '1994-02-27'),
    c('Alexandre Carrier', 'D', 'MTL', 3_750_000, 2, 2, 2027, 'UFA', 'NHL', null, '1996-10-08'),
    c('Jayden Struble', 'D', 'MTL', 1_412_500, 2, 2, 2027, 'RFA', 'NHL', null, '2001-09-08'),
    c('Arber Xhekaj', 'D', 'MTL', 1_300_000, 1, 1, 2026, 'RFA', 'NHL', null, '2001-01-30'),
    c('Lane Hutson', 'D', 'MTL', 950_000, 9, 9, 2034, 'UFA', 'NHL', null, '2004-02-14'),
    // AHL Defensemen
    c('Bryce Pickford', 'D', 'MTL', 940_833, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Adam Engstrom', 'D', 'MTL', 896_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('David Reinbacher', 'D', 'MTL', 886_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Gannon Laroque', 'D', 'MTL', 836_667, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Nate Clurman', 'D', 'MTL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('William Trudeau', 'D', 'MTL', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Marc Del Gaizo', 'D', 'MTL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Goalies
    c('Sam Montembeault', 'G', 'MTL', 3_150_000, 2, 2, 2027, 'UFA', 'NHL', null),
    c('Jakub Dobes', 'G', 'MTL', 965_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-05-27'),
    // AHL Goalies
    c('Kaapo Kahkonen', 'G', 'MTL', 1_150_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Jacob Fowler', 'G', 'MTL', 923_333, 3, 3, 2028, 'RFA', 'AHL', null),
  ],

  // ============================================================
  // OTT - Ottawa Senators
  // ============================================================
  'OTT': [
    // Forwards
    c('Tim Stutzle', 'C', 'OTT', 8_350_000, 6, 6, 2031, 'UFA', 'NHL', null),
    c('Brady Tkachuk', 'LW', 'OTT', 8_205_714, 3, 3, 2028, 'UFA', 'NHL', 'NMC', '1999-09-16'),
    c('Dylan Cozens', 'C', 'OTT', 7_100_000, 5, 5, 2030, 'UFA', 'NHL', null, '2001-02-09'),
    c('Drake Batherson', 'RW', 'OTT', 4_975_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-04-27'),
    c('Fabian Zetterlund', 'RW', 'OTT', 4_275_000, 3, 3, 2028, 'UFA', 'NHL', null, '1999-08-25'),
    c('David Perron', 'LW', 'OTT', 4_000_000, 1, 1, 2026, 'UFA', 'IR', null, '1988-05-28'),
    c('Shane Pinto', 'C', 'OTT', 3_750_000, 5, 5, 2030, 'UFA', 'NHL', null, '2000-11-12'),
    c('Ridly Greig', 'LW', 'OTT', 3_250_000, 4, 4, 2029, 'RFA', 'NHL', null, '2002-08-08'),
    c('Michael Amadio', 'LW', 'OTT', 2_600_000, 2, 2, 2027, 'UFA', 'NHL', null, '1996-05-13'),
    c('Claude Giroux', 'RW', 'OTT', 2_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1988-01-12'),
    c('Lars Eller', 'C', 'OTT', 1_250_000, 1, 1, 2026, 'UFA', 'NHL', null, '1989-05-08'),
    c('Kurtis MacDermid', 'LW', 'OTT', 1_150_000, 2, 2, 2027, 'UFA', 'NHL', null, '1994-03-25'),
    c('Nick Cousins', 'LW', 'OTT', 825_000, 1, 1, 2026, 'UFA', 'NHL', null, '1993-07-20'),
    // Defensemen
    c('Jake Sanderson', 'D', 'OTT', 8_050_000, 7, 7, 2032, 'UFA', 'NHL', null, '2002-07-08'),
    c('Thomas Chabot', 'D', 'OTT', 8_000_000, 3, 3, 2028, 'UFA', 'NHL', 'NMC', '1997-01-30'),
    c('Artem Zub', 'D', 'OTT', 4_600_000, 2, 2, 2027, 'UFA', 'NHL', null, '1995-10-03'),
    c('Nick Jensen', 'D', 'OTT', 4_050_000, 1, 1, 2026, 'UFA', 'NHL', null, '1990-09-21'),
    c('Tyler Kleven', 'D', 'OTT', 1_600_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-01-10'),
    c('Jordan Spence', 'D', 'OTT', 1_500_000, 1, 1, 2026, 'RFA', 'NHL', null, '2001-02-24'),
    c('Nikolas Matinpalo', 'D', 'OTT', 875_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-10-05'),
    // Goalies
    c('Linus Ullmark', 'G', 'OTT', 8_250_000, 4, 4, 2029, 'UFA', 'NHL', null, '1993-07-31'),
    c('James Reimer', 'G', 'OTT', 850_000, 1, 1, 2026, 'UFA', 'NHL', null, '1988-03-15'),
  ],

  // ============================================================
  // TBL - Tampa Bay Lightning
  // ============================================================
  'TBL': [
    // Forwards
    c('Brayden Point', 'C', 'TBL', 9_500_000, 6, 5, 2030, 'UFA', 'LTIR', 'NMC', '1996-03-13'),
    c('Nikita Kucherov', 'RW', 'TBL', 9_500_000, 3, 2, 2027, 'UFA', 'NHL', 'NMC', '1993-06-17'),
    c('Jake Guentzel', 'LW', 'TBL', 9_000_000, 7, 6, 2031, 'UFA', 'NHL', 'NMC', '1994-10-06'),
    c('Brandon Hagel', 'LW', 'TBL', 6_500_000, 8, 7, 2032, 'UFA', 'NHL', null, '1998-08-27'),
    c('Anthony Cirelli', 'C', 'TBL', 6_250_000, 7, 6, 2031, 'UFA', 'NHL', null, '1997-07-15'),
    c('Oliver Bjorkstrand', 'RW', 'TBL', 5_400_000, 2, 1, 2026, 'UFA', 'NHL', null, '1995-04-10'),
    c('Nicholas Paul', 'C', 'TBL', 3_150_000, 5, 4, 2029, 'UFA', 'NHL', null),
    c('Yanni Gourde', 'C', 'TBL', 2_333_333, 7, 6, 2031, 'UFA', 'NHL', null, '1991-12-15'),
    c('Pontus Holmberg', 'RW', 'TBL', 1_550_000, 2, 2, 2027, 'UFA', 'NHL', null, '1999-03-09'),
    c('Gage Goncalves', 'RW', 'TBL', 1_200_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-01-16'),
    c('Dominic James', 'C', 'TBL', 910_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-07-03'),
    c('Zemgus Girgensons', 'LW', 'TBL', 850_000, 3, 2, 2027, 'UFA', 'NHL', null, '1994-01-05'),
    c('Curtis Douglas', 'LW', 'TBL', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '2000-03-06'),
    c('Scott Sabourin', 'RW', 'TBL', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1992-07-30'),
    // Defensemen
    c('Victor Hedman', 'D', 'TBL', 8_000_000, 5, 4, 2029, 'UFA', 'NHL', 'NMC', '1990-12-18'),
    c('Ryan McDonagh', 'D', 'TBL', 6_750_000, 5, 4, 2029, 'UFA', 'NHL', 'M-NTC', '1989-06-13'),
    c('J.J. Moser', 'D', 'TBL', 6_750_000, 10, 9, 2034, 'UFA', 'NHL', null, '2000-06-06'),
    c('Erik Cernak', 'D', 'TBL', 5_200_000, 7, 6, 2031, 'UFA', 'NHL', null, '1997-05-28'),
    c('Darren Raddysh', 'D', 'TBL', 975_000, 2, 1, 2026, 'UFA', 'NHL', null, '1996-02-28'),
    c('Emil Lilleberg', 'D', 'TBL', 800_000, 2, 2, 2027, 'RFA', 'IR', null, '2001-02-02'),
    c('Maxwell Crozier', 'D', 'TBL', 775_000, 3, 3, 2028, 'UFA', 'IR', null),
    c('Charle-Edouard D\'Astous', 'D', 'TBL', 775_000, 2, 2, 2027, 'UFA', 'IR', null),
    c('Declan Carlile', 'D', 'TBL', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '2000-05-18'),
    // Goalies
    c('Andrei Vasilevskiy', 'G', 'TBL', 9_500_000, 4, 3, 2028, 'UFA', 'NHL', 'NMC', '1994-07-25'),
    c('Jonas Johansson', 'G', 'TBL', 1_250_000, 2, 2, 2027, 'UFA', 'NHL', null, '1995-09-19'),
  ],

  // ============================================================
  // TOR - Toronto Maple Leafs
  // ============================================================
  'TOR': [
    // Forwards
    c('Auston Matthews', 'C', 'TOR', 13_250_000, 3, 3, 2028, 'UFA', 'NHL', 'NMC', '1997-09-17'),
    c('William Nylander', 'RW', 'TOR', 11_500_000, 7, 7, 2032, 'UFA', 'NHL', null, '1996-05-01'),
    c('Matthew Knies', 'LW', 'TOR', 7_750_000, 6, 6, 2031, 'UFA', 'NHL', null, '2002-10-17'),
    c('John Tavares', 'C', 'TOR', 4_380_000, 4, 4, 2029, 'UFA', 'NHL', null, '1990-09-20'),
    c('Max Domi', 'RW', 'TOR', 3_750_000, 3, 3, 2028, 'UFA', 'NHL', null, '1995-03-02'),
    c('Dakota Joshua', 'LW', 'TOR', 3_250_000, 3, 3, 2028, 'UFA', 'LTIR', null, '1996-05-15'),
    c('Matias Maccelli', 'LW', 'TOR', 3_425_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-10-14'),
    c('Nicolas Roy', 'C', 'TOR', 3_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1997-02-05'),
    c('Calle Jarnkrok', 'RW', 'TOR', 2_100_000, 1, 1, 2026, 'UFA', 'NHL', null, '1991-09-25'),
    c('Nicholas Robertson', 'RW', 'TOR', 1_825_000, 1, 1, 2026, 'RFA', 'NHL', null, '2001-09-11'),
    c('Scott Laughton', 'C', 'TOR', 1_500_000, 1, 1, 2026, 'UFA', 'NHL', null, '1994-05-30'),
    c('Bobby McMann', 'LW', 'TOR', 1_350_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-06-15'),
    c('Steven Lorentz', 'LW', 'TOR', 1_350_000, 3, 3, 2028, 'UFA', 'NHL', null, '1996-04-13'),
    c('Easton Cowan', 'RW', 'TOR', 873_500, 3, 3, 2028, 'RFA', 'NHL', null, '2005-05-20'),
    c('Bo Groulx', 'C', 'TOR', 812_500, 2, 2, 2027, 'UFA', 'NHL', null),
    // Defensemen
    c('Morgan Rielly', 'D', 'TOR', 7_500_000, 5, 5, 2030, 'UFA', 'NHL', 'NMC', '1994-03-09'),
    c('Jake McCabe', 'D', 'TOR', 4_491_898, 5, 5, 2030, 'UFA', 'NHL', null, '1993-10-12'),
    c('Chris Tanev', 'D', 'TOR', 3_817_293, 5, 5, 2030, 'UFA', 'LTIR', null, '1989-12-20'),
    c('Oliver Ekman-Larsson', 'D', 'TOR', 3_500_000, 3, 3, 2028, 'UFA', 'NHL', null, '1991-07-17'),
    c('Brandon Carlo', 'D', 'TOR', 3_485_000, 2, 2, 2027, 'UFA', 'NHL', null, '1996-11-26'),
    c('Simon Benoit', 'D', 'TOR', 1_350_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-09-19'),
    c('Philippe Myers', 'D', 'TOR', 850_000, 2, 2, 2027, 'UFA', 'NHL', null, '1997-01-25'),
    c('Troy Stecher', 'D', 'TOR', 787_500, 1, 1, 2026, 'UFA', 'NHL', null, '1994-04-07'),
    c('William Villeneuve', 'D', 'TOR', 775_000, 1, 1, 2026, 'RFA', 'NHL', null),
    // Goalies
    c('Joseph Woll', 'G', 'TOR', 3_666_667, 3, 3, 2028, 'UFA', 'NHL', null, '1998-07-12'),
    c('Anthony Stolarz', 'G', 'TOR', 2_500_000, 5, 5, 2030, 'UFA', 'NHL', null, '1994-01-20'),
  ],


  // ============================================================
  // CAR - Carolina Hurricanes
  // ============================================================
  'CAR': [
    // Forwards
    c('Sebastian Aho', 'C', 'CAR', 9_750_000, 8, 7, 2032, 'UFA', 'NHL', 'M-NTC', '1997-07-26'),
    c('Nikolaj Ehlers', 'LW', 'CAR', 8_500_000, 6, 6, 2031, 'UFA', 'NHL', null, '1996-02-14'),
    c('Andrei Svechnikov', 'LW', 'CAR', 7_750_000, 5, 4, 2029, 'UFA', 'NHL', null, '2000-03-26'),
    c('Seth Jarvis', 'RW', 'CAR', 7_900_000, 8, 7, 2032, 'UFA', 'NHL', null, '2002-02-01'),
    c('Jesperi Kotkaniemi', 'C', 'CAR', 4_820_000, 6, 5, 2030, 'UFA', 'NHL', null, '2000-07-06'),
    c('Taylor Hall', 'LW', 'CAR', 3_166_667, 3, 3, 2028, 'UFA', 'NHL', null, '1991-11-14'),
    c('Jordan Martinook', 'RW', 'CAR', 3_050_000, 3, 2, 2027, 'UFA', 'NHL', null, '1992-07-25'),
    c('Jordan Staal', 'C', 'CAR', 2_900_000, 3, 2, 2027, 'UFA', 'NHL', 'M-NTC', '1988-09-10'),
    c('William Carrier', 'LW', 'CAR', 2_000_000, 6, 5, 2030, 'UFA', 'NHL', null, '1994-12-20'),
    c('Eric Robinson', 'RW', 'CAR', 1_700_000, 5, 4, 2029, 'UFA', 'NHL', null, '1995-06-14'),
    c('Jackson Blake', 'RW', 'CAR', 925_000, 9, 2, 2034, 'UFA', 'NHL', null, '2003-08-03'),
    c('Logan Stankoven', 'C', 'CAR', 880_000, 9, 2, 2026, 'UFA', 'NHL', null, '2003-02-26'),
    c('Mark Jankowski', 'C', 'CAR', 800_000, 2, 1, 2026, 'UFA', 'NHL', null, '1994-09-13'),
    c('Ivan Ryabkin', 'C', 'CAR', 918_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Bradly Nadeau', 'RW', 'CAR', 886_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Viktor Neuchev', 'LW', 'CAR', 950_000, 2, 2, 2026, 'RFA', 'AHL', null),
    c('Gleb Trikozov', 'LW', 'CAR', 875_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Justin Robidas', 'C', 'CAR', 851_667, 2, 2, 2026, 'RFA', 'AHL', null),
    c('Noel Gunler', 'RW', 'CAR', 813_750, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Felix Unger Sorum', 'RW', 'CAR', 803_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Skyler Brind\'Amour', 'C', 'CAR', 775_000, 2, 1, 2026, 'RFA', 'AHL', null),
    c('Josiah Slavin', 'LW', 'CAR', 775_000, 2, 2, 2026, 'UFA', 'AHL', null),
    c('Ryan Suzuki', 'C', 'CAR', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Givani Smith', 'RW', 'CAR', 775_000, 2, 1, 2026, 'UFA', 'AHL', null),
    c('Juha Jaaska', 'LW', 'CAR', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Noah Philp', 'C', 'CAR', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Defensemen
    c('K\'Andre Miller', 'D', 'CAR', 7_500_000, 8, 8, 2033, 'UFA', 'NHL', null),
    c('Jaccob Slavin', 'D', 'CAR', 6_461_250, 8, 8, 2033, 'UFA', 'NHL', 'NMC', '1994-05-01'),
    c('Sean Walker', 'D', 'CAR', 3_600_000, 5, 4, 2029, 'UFA', 'NHL', null, '1994-11-13'),
    c('Shayne Gostisbehere', 'D', 'CAR', 3_200_000, 3, 2, 2027, 'UFA', 'NHL', null, '1993-04-20'),
    c('Jalen Chatfield', 'D', 'CAR', 3_000_000, 3, 2, 2027, 'UFA', 'NHL', null, '1996-05-15'),
    c('Mike Reilly', 'D', 'CAR', 1_100_000, 1, 1, 2026, 'UFA', 'NHL', null, '1993-07-13'),
    c('Alexander Nikishin', 'D', 'CAR', 2_943_750, 2, 1, 2026, 'RFA', 'NHL', null, '2001-10-02'),
    c('Juuso Valimaki', 'D', 'CAR', 2_000_000, 2, 1, 2026, 'UFA', 'AHL', null),
    c('Joel Nystrom', 'D', 'CAR', 1_225_000, 5, 5, 2030, 'UFA', 'AHL', null),
    c('Charles-Alexis Legault', 'D', 'CAR', 950_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Kyle Masters', 'D', 'CAR', 900_000, 2, 2, 2026, 'RFA', 'AHL', null),
    c('Bryce Montgomery', 'D', 'CAR', 1_854_910, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Ronan Seeley', 'D', 'CAR', 813_750, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Aleksi Heimosalmi', 'D', 'CAR', 880_000, 2, 2, 2026, 'RFA', 'AHL', null),
    c('Domenick Fensore', 'D', 'CAR', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    // Goalies
    c('Frederik Andersen', 'G', 'CAR', 3_500_000, 1, 1, 2026, 'UFA', 'NHL', null, '1989-10-02'),
    c('Pyotr Kochetkov', 'G', 'CAR', 2_000_000, 3, 2, 2027, 'UFA', 'IR', null, '1999-06-25'),
    c('Brandon Bussi', 'G', 'CAR', 1_900_000, 4, 1, 2026, 'UFA', 'NHL', null, '1998-06-25'),
    c('Ruslan Khazheev', 'G', 'CAR', 845_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Nikita Quapp', 'G', 'CAR', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Amir Miftakhov', 'G', 'CAR', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Cayden Primeau', 'G', 'CAR', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
  ],

  // ============================================================
  // CBJ - Columbus Blue Jackets
  // ============================================================
  'CBJ': [
    // Forwards
    c('Sean Monahan', 'C', 'CBJ', 5_500_000, 4, 4, 2029, 'UFA', 'NHL', null, '1994-10-12'),
    c('Charlie Coyle', 'C', 'CBJ', 5_250_000, 1, 1, 2026, 'UFA', 'NHL', null, '1992-03-02'),
    c('Mason Marchment', 'LW', 'CBJ', 4_500_000, 1, 1, 2026, 'UFA', 'NHL', null, '1995-06-18'),
    c('Dmitri Voronkov', 'LW', 'CBJ', 4_175_000, 2, 2, 2027, 'RFA', 'NHL', null, '2000-09-10'),
    c('Kirill Marchenko', 'RW', 'CBJ', 3_850_000, 2, 2, 2027, 'RFA', 'NHL', null, '2000-07-21'),
    c('Boone Jenner', 'LW', 'CBJ', 3_750_000, 1, 1, 2026, 'UFA', 'NHL', null, '1993-06-15'),
    c('Mathieu Olivier', 'RW', 'CBJ', 3_000_000, 6, 6, 2031, 'UFA', 'NHL', null, '1997-02-11'),
    c('Miles Wood', 'LW', 'CBJ', 2_500_000, 4, 4, 2029, 'UFA', 'NHL', null, '1995-09-13'),
    c('Cole Sillinger', 'LW', 'CBJ', 2_250_000, 1, 1, 2026, 'RFA', 'NHL', null, '2003-05-16'),
    c('Danton Heinen', 'LW', 'CBJ', 2_250_000, 1, 1, 2026, 'UFA', 'NHL', null, '1995-07-05'),
    c('Kent Johnson', 'RW', 'CBJ', 1_800_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-10-18'),
    c('Isac Lundestrom', 'C', 'CBJ', 1_300_000, 2, 2, 2027, 'UFA', 'NHL', null, '1999-11-06'),
    c('Adam Fantilli', 'C', 'CBJ', 950_000, 1, 1, 2026, 'RFA', 'NHL', null, '2004-10-12'),
    c('Jack Williams', 'RW', 'CBJ', 923_750, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Oiva Keskinen', 'C', 'CBJ', 860_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jordan Dumais', 'RW', 'CBJ', 860_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Luca Del Bel Belluz', 'C', 'CBJ', 860_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Max McCue', 'C', 'CBJ', 858_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Luca Pinelli', 'LW', 'CBJ', 846_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('James Malatesta', 'LW', 'CBJ', 841_667, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Hunter McKown', 'C', 'CBJ', 800_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Owen Sillinger', 'C', 'CBJ', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Hudson Fasching', 'RW', 'CBJ', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Mikael Pyyhtia', 'RW', 'CBJ', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Zach Aston-Reese', 'LW', 'CBJ', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Brendan Gaunce', 'C', 'CBJ', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Defensemen
    c('Zach Werenski', 'D', 'CBJ', 9_583_333, 3, 3, 2028, 'UFA', 'NHL', 'NMC', '1997-07-19'),
    c('Ivan Provorov', 'D', 'CBJ', 8_500_000, 7, 7, 2032, 'UFA', 'NHL', null, '1997-01-13'),
    c('Damon Severson', 'D', 'CBJ', 6_250_000, 6, 6, 2031, 'UFA', 'NHL', 'M-NTC', '1994-08-07'),
    c('Dante Fabbro', 'D', 'CBJ', 4_125_000, 4, 4, 2029, 'UFA', 'NHL', null, '1998-06-20'),
    c('Erik Gudbranson', 'D', 'CBJ', 4_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1992-01-07'),
    c('Egor Zamula', 'D', 'CBJ', 1_000_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-03-30'),
    c('Jake Christiansen', 'D', 'CBJ', 975_000, 2, 2, 2027, 'UFA', 'NHL', null, '1999-09-12'),
    c('Denton Mateychuk', 'D', 'CBJ', 886_667, 2, 2, 2027, 'RFA', 'NHL', null, '2004-07-12'),
    c('Brendan Smith', 'D', 'CBJ', 800_000, 1, 1, 2026, 'UFA', 'IR', null, '1989-02-08'),
    c('Corson Ceulemans', 'D', 'CBJ', 925_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Caleb MacDonald', 'D', 'CBJ', 922_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Charlie Elick', 'D', 'CBJ', 906_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Guillaume Richard', 'D', 'CBJ', 867_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Luca Marrelli', 'D', 'CBJ', 839_167, 4, 4, 2028, 'RFA', 'AHL', null),
    c('Stanislav Svozil', 'D', 'CBJ', 825_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Dysin Mayo', 'D', 'CBJ', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Goalies
    c('Elvis Merzlikins', 'G', 'CBJ', 5_400_000, 2, 2, 2027, 'UFA', 'NHL', 'M-NTC', '1994-04-13'),
    c('Jet Greaves', 'G', 'CBJ', 812_500, 1, 1, 2026, 'RFA', 'NHL', null, '2001-03-30'),
    c('Ivan Fedotov', 'G', 'CBJ', 2_125_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Evan Gardner', 'G', 'CBJ', 870_833, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Nolan Lalonde', 'G', 'CBJ', 785_556, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Zach Sawchenko', 'G', 'CBJ', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
  ],

  // ============================================================
  // NJD - New Jersey Devils
  // ============================================================
  'NJD': [
    // Forwards
    c('Timo Meier', 'LW', 'NJD', 8_800_000, 6, 6, 2031, 'UFA', 'NHL', 'M-NTC', '1996-10-08'),
    c('Jack Hughes', 'C', 'NJD', 8_000_000, 5, 5, 2030, 'UFA', 'NHL', null),
    c('Jesper Bratt', 'RW', 'NJD', 7_875_000, 6, 6, 2031, 'UFA', 'NHL', null, '1998-07-30'),
    c('Nico Hischier', 'C', 'NJD', 7_250_000, 2, 2, 2027, 'UFA', 'NHL', 'NMC', '1999-01-04'),
    c('Dawson Mercer', 'RW', 'NJD', 4_000_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-10-27'),
    c('Connor Brown', 'RW', 'NJD', 3_000_000, 4, 4, 2029, 'UFA', 'NHL', null, '1994-01-14'),
    c('Cody Glass', 'C', 'NJD', 2_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1999-04-01'),
    c('Maxim Tsyplakov', 'RW', 'NJD', 2_250_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-09-19'),
    c('Nick Bjugstad', 'C', 'NJD', 1_750_000, 2, 2, 2027, 'UFA', 'NHL', null, '1992-07-17'),
    c('Evgenii Dadonov', 'LW', 'NJD', 1_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1989-03-12'),
    c('Arseni Gritsyuk', 'LW', 'NJD', 925_000, 1, 1, 2026, 'RFA', 'NHL', null),
    c('Paul Cotter', 'LW', 'NJD', 775_000, 1, 1, 2026, 'RFA', 'NHL', null, '1999-11-16'),
    c('Luke Glendening', 'C', 'NJD', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1989-04-28'),
    c('Stefan Noesen', 'RW', 'NJD', 2_750_000, 2, 2, 2027, 'UFA', 'LTIR', null, '1993-02-12'),
    c('Zack MacEwen', 'RW', 'NJD', 775_000, 1, 1, 2026, 'UFA', 'LTIR', null, '1996-07-08'),
    c('Lenni Hameenaho', 'RW', 'NJD', 950_000, 3, 3, 2028, 'RFA', 'AHL', null, '2004-11-07'),
    c('Shane Lachance', 'LW', 'NJD', 925_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Dylan Wendt', 'RW', 'NJD', 870_000, 1, 1, 2026, 'RFA', 'AHL', null, '2001-01-09'),
    c('Cam Squires', 'RW', 'NJD', 838_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Josh Filmon', 'LW', 'NJD', 838_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Ryan Schmelzer', 'C', 'NJD', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Jonathan Gruden', 'LW', 'NJD', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Mike Hardman', 'LW', 'NJD', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Brian Halonen', 'RW', 'NJD', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Xavier Parent', 'C', 'NJD', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Nathan Legare', 'RW', 'NJD', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Angus Crookshank', 'RW', 'NJD', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Marc McLaughlin', 'C', 'NJD', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Defensemen
    c('Dougie Hamilton', 'D', 'NJD', 9_000_000, 3, 3, 2028, 'UFA', 'NHL', 'NMC', '1993-06-17'),
    c('Luke Hughes', 'D', 'NJD', 9_000_000, 7, 7, 2032, 'UFA', 'LTIR', null, '2003-09-09'),
    c('Brett Pesce', 'D', 'NJD', 5_500_000, 5, 5, 2030, 'UFA', 'NHL', null, '1994-11-15'),
    c('Brenden Dillon', 'D', 'NJD', 4_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1990-11-13'),
    c('Johnathan Kovacevic', 'D', 'NJD', 4_000_000, 5, 5, 2030, 'UFA', 'NHL', null, '1997-07-12'),
    c('Jonas Siegenthaler', 'D', 'NJD', 3_400_000, 3, 3, 2028, 'UFA', 'NHL', null, '1997-05-06'),
    c('Simon Nemec', 'D', 'NJD', 918_333, 1, 1, 2026, 'RFA', 'NHL', null),
    c('Colton White', 'D', 'NJD', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-05-03'),
    c('Dennis Cholowski', 'D', 'NJD', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-02-15'),
    c('Mikael Diotte', 'D', 'NJD', 950_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Seamus Casey', 'D', 'NJD', 950_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Ethan Edwards', 'D', 'NJD', 925_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Jeremy Hanzel', 'D', 'NJD', 851_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Topias Vilen', 'D', 'NJD', 836_667, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Calen Addison', 'D', 'NJD', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    // Goalies
    c('Jacob Markstrom', 'G', 'NJD', 4_125_000, 3, 3, 2028, 'UFA', 'NHL', null, '1990-01-31'),
    c('Jake Allen', 'G', 'NJD', 1_800_000, 5, 5, 2030, 'UFA', 'NHL', null, '1990-08-07'),
    c('Jakub Malek', 'G', 'NJD', 867_500, 1, 1, 2026, 'RFA', 'NHL', null),
    c('Tyler Brennan', 'G', 'NJD', 870_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Nico Daws', 'G', 'NJD', 812_500, 1, 1, 2026, 'RFA', 'AHL', null),
  ],

  // ============================================================
  // NYI - New York Islanders
  // ============================================================
  'NYI': [
    // Forwards
    c('Mathew Barzal', 'C', 'NYI', 9_150_000, 6, 6, 2031, 'UFA', 'NHL', 'M-NTC', '1997-05-26'),
    c('Bo Horvat', 'C', 'NYI', 8_500_000, 6, 6, 2031, 'UFA', 'NHL', 'NMC', '1995-04-05'),
    c('Anders Lee', 'LW', 'NYI', 7_000_000, 1, 1, 2026, 'UFA', 'NHL', 'NMC', '1990-07-03'),
    c('Ondrej Palat', 'LW', 'NYI', 6_000_000, 2, 2, 2027, 'UFA', 'NHL', 'M-NTC', '1991-03-28'),
    c('Jean-Gabriel Pageau', 'C', 'NYI', 5_000_000, 1, 1, 2026, 'UFA', 'NHL', 'M-NTC', '1992-11-11'),
    c('Kyle Palmieri', 'RW', 'NYI', 4_750_000, 2, 2, 2027, 'UFA', 'LTIR', null, '1991-02-01'),
    c('Jonathan Drouin', 'LW', 'NYI', 4_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1995-03-28'),
    c('Simon Holmstrom', 'RW', 'NYI', 3_625_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-05-24'),
    c('Anthony Duclair', 'RW', 'NYI', 3_500_000, 3, 3, 2028, 'UFA', 'NHL', null, '1995-08-26'),
    c('Pierre Engvall', 'LW', 'NYI', 3_000_000, 5, 5, 2030, 'UFA', 'LTIR', null),
    c('Casey Cizikas', 'C', 'NYI', 2_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1991-02-27'),
    c('Emil Heineman', 'RW', 'NYI', 1_100_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-11-16'),
    c('Maxim Shabanov', 'LW', 'NYI', 975_000, 1, 1, 2026, 'RFA', 'NHL', null),
    c('Calum Ritchie', 'C', 'NYI', 918_333, 3, 3, 2028, 'RFA', 'NHL', null, '2005-01-21'),
    c('Marc Gatcomb', 'RW', 'NYI', 900_000, 1, 1, 2026, 'RFA', 'NHL', null, '1999-07-22'),
    c('Kyle MacLean', 'LW', 'NYI', 775_000, 2, 2, 2027, 'UFA', 'NHL', null, '1999-04-29'),
    c('Victor Eklund', 'RW', 'NYI', 975_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Daniil Prokhorov', 'RW', 'NYI', 915_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Gleb Veremyev', 'C', 'NYI', 885_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Matthew Maggio', 'RW', 'NYI', 870_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Camden Thiesing', 'C', 'NYI', 870_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Alex Jefferies', 'LW', 'NYI', 867_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Eetu Liukas', 'LW', 'NYI', 867_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Daylan Kuefler', 'LW', 'NYI', 840_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Jesse Nurmi', 'LW', 'NYI', 838_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Joey Larson', 'RW', 'NYI', 823_750, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Adam Beckman', 'LW', 'NYI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Julien Gauthier', 'RW', 'NYI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Liam Foudy', 'C', 'NYI', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Matthew Highmore', 'C', 'NYI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Defensemen
    c('Alexander Romanov', 'D', 'NYI', 6_250_000, 8, 8, 2033, 'UFA', 'LTIR', null, '2000-01-06'),
    c('Ryan Pulock', 'D', 'NYI', 6_150_000, 5, 5, 2030, 'UFA', 'NHL', 'NMC', '1994-10-06'),
    c('Adam Pelech', 'D', 'NYI', 5_750_000, 4, 4, 2029, 'UFA', 'NHL', 'NMC', '1994-08-16'),
    c('Scott Mayfield', 'D', 'NYI', 3_500_000, 5, 5, 2030, 'UFA', 'NHL', null, '1992-10-14'),
    c('Carson Soucy', 'D', 'NYI', 3_250_000, 1, 1, 2026, 'UFA', 'NHL', null, '1994-07-27'),
    c('Tony DeAngelo', 'D', 'NYI', 1_750_000, 1, 1, 2026, 'UFA', 'NHL', null, '1995-10-24'),
    c('Matthew Schaefer', 'D', 'NYI', 975_000, 3, 3, 2028, 'RFA', 'NHL', null, '2007-09-05'),
    c('Adam Boqvist', 'D', 'NYI', 850_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-08-15'),
    c('Jesse Pulkkinen', 'D', 'NYI', 880_833, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Isaiah George', 'D', 'NYI', 838_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Marshall Warren', 'D', 'NYI', 825_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Calle Odelius', 'D', 'NYI', 815_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Travis Mitchell', 'D', 'NYI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Ethan Bear', 'D', 'NYI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Cole McWard', 'D', 'NYI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Goalies
    c('Ilya Sorokin', 'G', 'NYI', 8_250_000, 7, 7, 2032, 'UFA', 'NHL', 'NMC', '1995-08-04'),
    c('Semyon Varlamov', 'G', 'NYI', 2_750_000, 2, 2, 2027, 'UFA', 'LTIR', null, '1988-04-27'),
    c('David Rittich', 'G', 'NYI', 1_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1992-08-19'),
    c('Tristan Lennox', 'G', 'NYI', 867_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Henrik Tikkanen', 'G', 'NYI', 823_750, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Marcus Hogberg', 'G', 'NYI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
  ],

  // ============================================================
  // NYR - New York Rangers
  // ============================================================
  'NYR': [
    // Forwards
    c('Mika Zibanejad', 'C', 'NYR', 8_500_000, 5, 5, 2030, 'UFA', 'NHL', 'NMC', '1993-04-18'),
    c('J.T. Miller', 'C', 'NYR', 8_000_000, 5, 5, 2030, 'UFA', 'NHL', null, '1993-03-14'),
    c('Alexis Lafreniere', 'RW', 'NYR', 7_450_000, 7, 7, 2032, 'UFA', 'NHL', null),
    c('Vincent Trocheck', 'C', 'NYR', 5_625_000, 4, 4, 2029, 'UFA', 'NHL', 'M-NTC', '1993-07-11'),
    c('Will Cuylle', 'LW', 'NYR', 3_900_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-02-05'),
    c('Taylor Raddysh', 'RW', 'NYR', 1_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-02-18'),
    c('Sam Carrick', 'C', 'NYR', 1_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1992-02-04'),
    c('Matt Rempe', 'RW', 'NYR', 975_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-06-29'),
    c('Gabe Perreault', 'LW', 'NYR', 941_667, 2, 2, 2027, 'RFA', 'NHL', null, '2005-05-07'),
    c('Noah Laba', 'C', 'NYR', 870_000, 2, 2, 2027, 'RFA', 'NHL', null, '2003-08-04'),
    c('Brett Berard', 'RW', 'NYR', 867_500, 1, 1, 2026, 'RFA', 'NHL', null),
    c('Brennan Othmann', 'LW', 'NYR', 863_333, 1, 1, 2026, 'RFA', 'NHL', null, '2003-01-05'),
    c('Jonny Brodzinski', 'RW', 'NYR', 787_500, 1, 1, 2026, 'UFA', 'NHL', null, '1993-06-19'),
    c('Brendan Brisson', 'C', 'NYR', 775_000, 1, 1, 2026, 'RFA', 'NHL', null, '2001-10-22'),
    c('Adam Edstrom', 'LW', 'NYR', 975_000, 2, 2, 2027, 'RFA', 'LTIR', null, '2000-10-12'),
    c('Conor Sheary', 'LW', 'NYR', 775_000, 1, 1, 2026, 'UFA', 'LTIR', null, '1992-06-08'),
    c('Liam Greentree', 'RW', 'NYR', 942_500, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Nathan Aspinall', 'LW', 'NYR', 925_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Carey Terrance', 'C', 'NYR', 886_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jaroslav Chmelar', 'RW', 'NYR', 867_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Kalle Vaisanen', 'LW', 'NYR', 863_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Dylan Roobroeck', 'C', 'NYR', 850_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Bryce McConnell-Barker', 'C', 'NYR', 838_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Adam Sykora', 'LW', 'NYR', 806_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Trey Fix-Wolansky', 'RW', 'NYR', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Justin Dowling', 'C', 'NYR', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Anton Blidh', 'LW', 'NYR', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Juuso Parssinen', 'LW', 'NYR', 100_000, 2, 2, 2027, 'RFA', 'AHL', null), // buried salary penalty
    // Defensemen
    c('Adam Fox', 'D', 'NYR', 9_500_000, 4, 4, 2029, 'UFA', 'LTIR', 'NMC', '1998-02-17'),
    c('Vladislav Gavrikov', 'D', 'NYR', 7_000_000, 7, 7, 2032, 'UFA', 'NHL', null, '1995-11-21'),
    c('Will Borgen', 'D', 'NYR', 4_100_000, 5, 5, 2030, 'UFA', 'NHL', null, '1996-12-19'),
    c('Braden Schneider', 'D', 'NYR', 2_200_000, 1, 1, 2026, 'RFA', 'NHL', null, '2001-09-20'),
    c('Urho Vaakanainen', 'D', 'NYR', 1_550_000, 2, 2, 2027, 'UFA', 'NHL', null, '1999-01-01'),
    c('Scott Morrow', 'D', 'NYR', 916_667, 1, 1, 2026, 'RFA', 'NHL', null, '2002-11-01'),
    c('Vincent Iorio', 'D', 'NYR', 814_167, 1, 1, 2026, 'RFA', 'NHL', null, '2002-11-14'),
    c('Matthew Robertson', 'D', 'NYR', 775_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-03-09'),
    c('Jackson Dorrington', 'D', 'NYR', 851_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Derrick Pouliot', 'D', 'NYR', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Casey Fitzgerald', 'D', 'NYR', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Brandon Scanlin', 'D', 'NYR', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Connor Mackey', 'D', 'NYR', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Goalies
    c('Igor Shesterkin', 'G', 'NYR', 11_500_000, 8, 8, 2033, 'UFA', 'IR', 'NMC', '1995-12-30'),
    c('Jonathan Quick', 'G', 'NYR', 1_550_000, 1, 1, 2026, 'UFA', 'NHL', null, '1986-01-21'),
    c('Hugo Ollas', 'G', 'NYR', 855_000, 1, 1, 2026, 'RFA', 'NHL', null, '2002-04-24'),
    c('Callum Tung', 'G', 'NYR', 872_500, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Talyn Boyko', 'G', 'NYR', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Dylan Garand', 'G', 'NYR', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Spencer Martin', 'G', 'NYR', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    // Retained salary: Artemi Panarin - 50% retained ($5,821,429 cap hit retained by NYR)
  ],

  // ============================================================
  // PHI - Philadelphia Flyers
  // ============================================================
  'PHI': [
    // Forwards
    c('Travis Konecny', 'RW', 'PHI', 8_750_000, 8, 8, 2033, 'UFA', 'NHL', 'M-NTC', '1997-03-11'),
    c('Sean Couturier', 'C', 'PHI', 7_750_000, 5, 5, 2030, 'UFA', 'NHL', 'NMC', '1992-12-07'),
    c('Owen Tippett', 'RW', 'PHI', 6_200_000, 7, 7, 2032, 'UFA', 'NHL', null, '1999-02-16'),
    c('Trevor Zegras', 'C', 'PHI', 5_750_000, 1, 1, 2026, 'RFA', 'NHL', null, '2001-03-20'),
    c('Christian Dvorak', 'C', 'PHI', 5_400_000, 6, 6, 2031, 'UFA', 'NHL', null, '1996-02-02'),
    c('Noah Cates', 'C', 'PHI', 4_000_000, 4, 4, 2029, 'UFA', 'NHL', null, '1999-02-05'),
    c('Tyson Foerster', 'LW', 'PHI', 3_750_000, 2, 2, 2027, 'RFA', 'IR', null, '2002-01-18'),
    c('Garnet Hathaway', 'RW', 'PHI', 2_400_000, 2, 2, 2027, 'UFA', 'NHL', null, '1991-11-23'),
    c('Carl Grundstrom', 'LW', 'PHI', 1_800_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-12-01'),
    c('Nicolas Deslauriers', 'LW', 'PHI', 1_750_000, 1, 1, 2026, 'UFA', 'NHL', null, '1991-02-22'),
    c('Bobby Brink', 'RW', 'PHI', 1_500_000, 1, 1, 2026, 'RFA', 'NHL', null, '2001-07-08'),
    c('Matvei Michkov', 'LW', 'PHI', 950_000, 2, 2, 2027, 'RFA', 'NHL', null, '2004-12-09'),
    c('Denver Barkey', 'LW', 'PHI', 881_667, 3, 3, 2028, 'RFA', 'NHL', null, '2005-04-27'),
    c('Nikita Grebenkin', 'LW', 'PHI', 875_000, 1, 1, 2026, 'RFA', 'NHL', null, '2003-05-02'),
    c('Rodrigo Abols', 'C', 'PHI', 800_000, 1, 1, 2026, 'UFA', 'IR', null, '1996-01-05'),
    c('Karsen Dorwart', 'LW', 'PHI', 975_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Alex Bump', 'LW', 'PHI', 950_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jett Luchanko', 'C', 'PHI', 942_500, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Massimo Rizzo', 'C', 'PHI', 925_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Devin Kaplan', 'RW', 'PHI', 921_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Jacob Gaucher', 'C', 'PHI', 872_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Tucker Robertson', 'C', 'PHI', 870_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Alexis Gendron', 'RW', 'PHI', 860_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Oscar Eklind', 'LW', 'PHI', 800_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Anthony Richard', 'C', 'PHI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Lane Pederson', 'C', 'PHI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Philip Tomasino', 'RW', 'PHI', 600_000, 1, 1, 2026, 'RFA', 'AHL', null),
    // Defensemen
    c('Travis Sanheim', 'D', 'PHI', 6_250_000, 6, 6, 2031, 'UFA', 'NHL', 'M-NTC'),
    c('Cam York', 'D', 'PHI', 5_150_000, 5, 5, 2030, 'UFA', 'NHL', null, '2001-01-05'),
    c('Rasmus Ristolainen', 'D', 'PHI', 5_100_000, 2, 2, 2027, 'UFA', 'NHL', 'M-NTC'),
    c('Nick Seeler', 'D', 'PHI', 2_700_000, 3, 3, 2028, 'UFA', 'NHL', null, '1993-06-03'),
    c('Jamie Drysdale', 'D', 'PHI', 2_300_000, 1, 1, 2026, 'RFA', 'NHL', null, '2002-04-08'),
    c('Hunter McDonald', 'D', 'PHI', 950_000, 1, 1, 2026, 'RFA', 'NHL', null),
    c('Emil Andrae', 'D', 'PHI', 903_333, 1, 1, 2026, 'RFA', 'NHL', null, '2002-02-23'),
    c('Noah Juulsen', 'D', 'PHI', 900_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-04-02'),
    c('Spencer Gill', 'D', 'PHI', 890_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Oliver Bonk', 'D', 'PHI', 886_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Christian Kyrou', 'D', 'PHI', 878_333, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Artem Guryev', 'D', 'PHI', 860_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Ty Murchison', 'D', 'PHI', 860_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Roman Schmidt', 'D', 'PHI', 805_833, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Helge Grans', 'D', 'PHI', 787_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Adam Ginning', 'D', 'PHI', 787_500, 1, 1, 2026, 'UFA', 'AHL', null, '2000-01-13'),
    c('Maxence Guenette', 'D', 'PHI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Goalies
    c('Dan Vladar', 'G', 'PHI', 3_350_000, 2, 2, 2027, 'UFA', 'NHL', null, '1997-08-20'),
    c('Samuel Ersson', 'G', 'PHI', 1_450_000, 1, 1, 2026, 'RFA', 'NHL', null, '1999-10-20'),
    c('Carson Bjarnason', 'G', 'PHI', 850_000, 3, 3, 2028, 'RFA', 'NHL', null),
    c('Aleksei Kolosov', 'G', 'PHI', 925_000, 1, 1, 2026, 'RFA', 'AHL', null),
    // Dead cap / retained salary (not player contracts):
    // Kevin Hayes: $3,571,428 retained by PHI
    // Scott Laughton: $1,500,000 retained by PHI
    // Cam Atkinson buyout: $1,758,333 cap hit
  ],

  // ============================================================
  // PIT - Pittsburgh Penguins
  // ============================================================
  'PIT': [
    // Forwards
    c('Sidney Crosby', 'C', 'PIT', 8_700_000, 2, 2, 2027, 'UFA', 'NHL', 'NMC', '1987-08-07'),
    c('Evgeni Malkin', 'C', 'PIT', 6_100_000, 1, 1, 2026, 'UFA', 'NHL', 'NMC', '1986-07-31'),
    c('Bryan Rust', 'RW', 'PIT', 5_125_000, 3, 3, 2028, 'UFA', 'NHL', 'M-NTC', '1992-05-11'),
    c('Rickard Rakell', 'LW', 'PIT', 5_000_000, 3, 3, 2028, 'UFA', 'NHL', null, '1993-05-05'),
    c('Kevin Hayes', 'C', 'PIT', 3_571_429, 1, 1, 2026, 'UFA', 'NHL', null, '1992-05-08'), // 50% retained by PHI
    c('Tommy Novak', 'LW', 'PIT', 3_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1997-04-28'),
    c('Anthony Mantha', 'LW', 'PIT', 2_500_000, 1, 1, 2026, 'UFA', 'NHL', null, '1994-09-16'),
    c('Yegor Chinakhov', 'RW', 'PIT', 2_100_000, 1, 1, 2026, 'RFA', 'NHL', null),
    c('Noel Acciari', 'RW', 'PIT', 2_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1991-12-01'),
    c('Blake Lizotte', 'C', 'PIT', 1_850_000, 4, 4, 2029, 'UFA', 'NHL', null, '1997-12-13'),
    c('Justin Brazeau', 'RW', 'PIT', 1_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-02-02'),
    c('Connor Dewar', 'LW', 'PIT', 1_100_000, 1, 1, 2026, 'UFA', 'NHL', null, '1999-06-26'),
    c('Benjamin Kindel', 'C', 'PIT', 975_000, 3, 3, 2028, 'RFA', 'NHL', null),
    c('Rutger McGroarty', 'LW', 'PIT', 950_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Tristan Broz', 'C', 'PIT', 925_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Melvin Fernstrom', 'RW', 'PIT', 872_500, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Mikhail Ilyin', 'RW', 'PIT', 851_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Tanner Howe', 'LW', 'PIT', 845_833, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Avery Hayes', 'C', 'PIT', 830_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Ville Koivunen', 'RW', 'PIT', 805_833, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Bokondji Imama', 'RW', 'PIT', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Rafael Harvey-Pinard', 'LW', 'PIT', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Joona Koppanen', 'LW', 'PIT', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Filip Hallander', 'RW', 'PIT', 775_000, 2, 2, 2027, 'UFA', 'AHL', null, '2000-06-29'),
    // Defensemen
    c('Erik Karlsson', 'D', 'PIT', 10_000_000, 2, 2, 2027, 'UFA', 'NHL', 'NMC', '1990-05-31'),
    c('Kris Letang', 'D', 'PIT', 6_100_000, 3, 3, 2028, 'UFA', 'IR', 'NMC', '1987-04-24'),
    c('Ryan Graves', 'D', 'PIT', 4_500_000, 4, 4, 2029, 'UFA', 'NHL', null, '1995-05-21'),
    c('Connor Clifton', 'D', 'PIT', 3_333_333, 1, 1, 2026, 'UFA', 'NHL', null, '1995-04-28'),
    c('Brett Kulak', 'D', 'PIT', 2_750_000, 1, 1, 2026, 'UFA', 'NHL', null, '1994-01-06'),
    c('Parker Wotherspoon', 'D', 'PIT', 1_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1997-08-24'),
    c('Ryan Shea', 'D', 'PIT', 900_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-02-11'),
    c('Jack St. Ivany', 'D', 'PIT', 775_000, 2, 2, 2027, 'UFA', 'IR', null, '1999-07-22'),
    c('Ilya Solovyov', 'D', 'PIT', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '2000-07-20'),
    c('Caleb Jones', 'D', 'PIT', 900_000, 2, 2, 2027, 'UFA', 'NHL', null), // suspended
    c('Owen Pickering', 'D', 'PIT', 886_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Peyton Kettles', 'D', 'PIT', 875_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Chase Pietila', 'D', 'PIT', 860_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Daniel Laatsch', 'D', 'PIT', 860_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Finn Harding', 'D', 'PIT', 855_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Harrison Brunicke', 'D', 'PIT', 845_833, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Emil Pieniniemi', 'D', 'PIT', 806_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Philip Kemp', 'D', 'PIT', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Sebastian Aho', 'D', 'PIT', 775_000, 1, 1, 2026, 'UFA', 'AHL', null, '1997-07-26'), // different from CAR forward Sebastian Aho
    c('Alexander Alexeyev', 'D', 'PIT', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Mathew Dumba', 'D', 'PIT', 2_600_000, 1, 1, 2026, 'UFA', 'AHL', null), // buried penalty
    // Goalies
    c('Stuart Skinner', 'G', 'PIT', 2_600_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-11-01'),
    c('Arturs Silovs', 'G', 'PIT', 850_000, 1, 1, 2026, 'RFA', 'NHL', null, '2001-03-22'),
    c('Joel Blomqvist', 'G', 'PIT', 886_667, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Sergey Murashov', 'G', 'PIT', 861_110, 2, 2, 2027, 'RFA', 'AHL', null),
  ],

  // ============================================================
  // WSH - Washington Capitals
  // ============================================================
  'WSH': [
    // Forwards
    c('Alex Ovechkin', 'LW', 'WSH', 9_500_000, 1, 1, 2026, 'UFA', 'NHL', 'NMC', '1985-09-17'),
    c('Pierre-Luc Dubois', 'C', 'WSH', 8_500_000, 6, 6, 2031, 'UFA', 'NHL', 'M-NTC', '1998-06-24'),
    c('Tom Wilson', 'RW', 'WSH', 6_500_000, 6, 6, 2031, 'UFA', 'NHL', 'M-NTC', '1994-03-29'),
    c('Dylan Strome', 'C', 'WSH', 5_000_000, 3, 3, 2028, 'UFA', 'NHL', null, '1997-03-07'),
    c('Aliaksei Protas', 'C', 'WSH', 3_375_000, 4, 4, 2029, 'UFA', 'NHL', null, '2001-01-06'),
    c('Nic Dowd', 'C', 'WSH', 3_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1990-05-27'),
    c('Anthony Beauvillier', 'RW', 'WSH', 2_750_000, 2, 2, 2027, 'UFA', 'NHL', null, '1997-06-08'),
    c('Connor McMichael', 'C', 'WSH', 2_100_000, 1, 1, 2026, 'RFA', 'IR', null, '2001-01-15'),
    c('Sonny Milano', 'LW', 'WSH', 1_900_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-05-12'),
    c('Brandon Duhaime', 'LW', 'WSH', 1_850_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-05-22'),
    c('Ryan Leonard', 'RW', 'WSH', 950_000, 2, 2, 2027, 'RFA', 'NHL', null, '2005-01-21'),
    c('Hendrix Lapierre', 'C', 'WSH', 850_000, 1, 1, 2026, 'RFA', 'NHL', null, '2002-02-09'),
    c('Justin Sourdif', 'C', 'WSH', 825_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-03-24'),
    c('Ethen Frank', 'RW', 'WSH', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-02-05'),
    c('Milton Gastrin', 'C', 'WSH', 975_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Lynden Lakovic', 'LW', 'WSH', 975_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Ivan Miroshnichenko', 'LW', 'WSH', 950_000, 3, 3, 2028, 'RFA', 'AHL', null),
    // Defensemen
    c('Jakob Chychrun', 'D', 'WSH', 9_000_000, 8, 8, 2033, 'UFA', 'NHL', 'M-NTC', '1998-03-31'),
    c('John Carlson', 'D', 'WSH', 8_000_000, 1, 1, 2026, 'UFA', 'NHL', 'NMC', '1990-01-10'),
    c('Matt Roy', 'D', 'WSH', 5_750_000, 5, 5, 2030, 'UFA', 'NHL', null, '1995-03-01'),
    c('Rasmus Sandin', 'D', 'WSH', 4_600_000, 4, 4, 2029, 'UFA', 'NHL', null, '2000-03-07'),
    c('Trevor van Riemsdyk', 'D', 'WSH', 3_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1991-07-24'),
    c('Martin Fehervary', 'D', 'WSH', 2_675_000, 8, 8, 2033, 'UFA', 'NHL', null),
    c('Declan Chisholm', 'D', 'WSH', 1_600_000, 2, 2, 2027, 'UFA', 'NHL', null, '2000-01-12'),
    c('Dylan McIlrath', 'D', 'WSH', 800_000, 2, 2, 2027, 'UFA', 'NHL', null, '1992-04-20'),
    c('Ryan Chesley', 'D', 'WSH', 923_333, 3, 3, 2028, 'RFA', 'AHL', null),
    // Goalies
    c('Logan Thompson', 'G', 'WSH', 5_850_000, 6, 6, 2031, 'UFA', 'NHL', null, '1997-02-25'),
    c('Charlie Lindgren', 'G', 'WSH', 3_000_000, 3, 3, 2028, 'UFA', 'IR', null, '1993-12-18'),
    c('Garin Bjorklund', 'G', 'WSH', 775_000, 1, 1, 2026, 'RFA', 'NHL', null),
    c('Mitchell Gibson', 'G', 'WSH', 812_500, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Clay Stevenson', 'G', 'WSH', 775_000, 3, 3, 2028, 'UFA', 'AHL', null, '1999-03-03'),
  ],


  // =========================================================================
  // ARI - Utah Hockey Club (uses ARI abbreviation in our system)
  // =========================================================================
  'ARI': [
    // --- Forwards ---
    c('JJ Peterka', 'RW', 'ARI', 7_700_000, 5, 5, 2030, 'UFA', 'NHL', 'M-NTC', '2002-01-14'),
    c('Clayton Keller', 'LW', 'ARI', 7_150_000, 3, 3, 2028, 'UFA', 'NHL', 'NTC'),
    c('Dylan Guenther', 'RW', 'ARI', 7_142_857, 8, 8, 2033, 'UFA', 'NHL', 'M-NTC', '2003-04-10'),
    c('Nick Schmaltz', 'C', 'ARI', 5_850_000, 1, 1, 2026, 'UFA', 'NHL', 'M-NTC', '1996-02-23'),
    c('Lawson Crouse', 'LW', 'ARI', 4_300_000, 2, 2, 2027, 'UFA', 'NHL', null, '1997-06-23'),
    c('Jack McBain', 'C', 'ARI', 4_250_000, 5, 5, 2030, 'UFA', 'NHL', null, '2000-01-06'),
    c('Alex Kerfoot', 'RW', 'ARI', 3_000_000, 1, 1, 2026, 'UFA', 'IR', 'M-NTC'),
    c('Barrett Hayton', 'C', 'ARI', 2_650_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-06-09'),
    c('Brandon Tanev', 'LW', 'ARI', 2_500_000, 3, 3, 2028, 'UFA', 'NHL', 'M-NTC', '1991-12-31'),
    c('Kevin Stenlund', 'C', 'ARI', 2_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-09-20'),
    c('Liam O\'Brien', 'RW', 'ARI', 1_000_000, 2, 2, 2027, 'UFA', 'NHL', null),
    c('Logan Cooley', 'C', 'ARI', 950_000, 9, 9, 2034, 'UFA', 'IR', null, '2004-05-04'),
    c('Danil But', 'LW', 'ARI', 950_000, 3, 3, 2028, 'RFA', 'NHL', null),
    c('Michael Carcone', 'RW', 'ARI', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-05-19'),
    c('Kailer Yamamoto', 'RW', 'ARI', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-09-29'),
    c('Ben McCartney', 'LW', 'ARI', 775_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-07-13'),
    // --- Defense ---
    c('Mikhail Sergachev', 'D', 'ARI', 8_500_000, 6, 6, 2031, 'UFA', 'NHL', 'M-NTC', '1998-06-25'),
    c('Sean Durzi', 'D', 'ARI', 6_000_000, 3, 3, 2028, 'UFA', 'NHL', 'M-NTC', '1998-10-21'),
    c('John Marino', 'D', 'ARI', 4_400_000, 2, 2, 2027, 'UFA', 'NHL', 'M-NTC', '1997-05-21'),
    c('Olli Maatta', 'D', 'ARI', 3_500_000, 3, 3, 2028, 'UFA', 'NHL', 'M-NTC'),
    c('Nate Schmidt', 'D', 'ARI', 3_500_000, 3, 3, 2028, 'UFA', 'NHL', 'M-NTC', '1991-07-16'),
    c('Ian Cole', 'D', 'ARI', 2_800_000, 1, 1, 2026, 'UFA', 'NHL', null, '1989-02-21'),
    c('Dmitriy Simashev', 'D', 'ARI', 950_000, 3, 3, 2028, 'RFA', 'NHL', null),
    c('Maveric Lamoureux', 'D', 'ARI', 886_667, 2, 2, 2027, 'RFA', 'NHL', null),
    c('Nick DeSimone', 'D', 'ARI', 800_000, 1, 1, 2026, 'UFA', 'NHL', null, '1994-11-21'),
    // --- Goalies ---
    c('Karel Vejmelka', 'G', 'ARI', 4_750_000, 5, 5, 2030, 'UFA', 'NHL', 'M-NTC', '1996-05-25'),
    c('Vitek Vanecek', 'G', 'ARI', 1_500_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-01-09'),
    c('Anson Thornton', 'G', 'ARI', 795_556, 1, 1, 2026, 'RFA', 'IR', null),
    c('Matt Villalta', 'G', 'ARI', 775_000, 1, 1, 2026, 'UFA', 'NHL', null),
    // --- Non-Roster ---
    c('Tij Iginla', 'C', 'ARI', 1_942_500, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Cole Beaudoin', 'C', 'ARI', 942_500, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Julian Lutz', 'LW', 'ARI', 950_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Miko Matikka', 'RW', 'ARI', 950_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Owen Allard', 'C', 'ARI', 869_167, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Gabe Smith', 'C', 'ARI', 869_167, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Noel Nordh', 'LW', 'ARI', 870_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Michal Kunc', 'LW', 'ARI', 861_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Sam Lipkin', 'LW', 'ARI', 851_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Cameron Hebig', 'C', 'ARI', 812_500, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Andrew Agozzino', 'C', 'ARI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Kevin Rooney', 'RW', 'ARI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Artem Duda', 'D', 'ARI', 950_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Tomas Lavoie', 'D', 'ARI', 872_500, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Maksymilian Szuber', 'D', 'ARI', 859_167, 2, 2, 2026, 'RFA', 'AHL', null),
    c('Terrell Goldsmith', 'D', 'ARI', 838_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Montana Onyebuchi', 'D', 'ARI', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Scott Perunovich', 'D', 'ARI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null, '1998-08-18'),
    c('Kevin Connauton', 'D', 'ARI', 775_000, 1, 1, 2026, 'UFA', 'AHL', null, '1990-02-23'),
    c('Jaxson Stauber', 'G', 'ARI', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
  ],

  // =========================================================================
  // CHI - Chicago Blackhawks
  // =========================================================================
  'CHI': [
    // --- Forwards (Roster) ---
    c('Tyler Bertuzzi', 'LW', 'CHI', 5_500_000, 4, 3, 2028, 'UFA', 'NHL', 'M-NTC', '1995-02-24'),
    c('Andre Burakovsky', 'RW', 'CHI', 5_500_000, 3, 2, 2027, 'UFA', 'NHL', 'M-NTC', '1995-02-09'),
    c('Teuvo Teravainen', 'LW', 'CHI', 5_400_000, 3, 2, 2027, 'UFA', 'NHL', 'M-NTC', '1994-09-11'),
    c('Nick Foligno', 'C', 'CHI', 4_500_000, 2, 1, 2026, 'UFA', 'NHL', null, '1987-10-31'),
    c('Jason Dickinson', 'C', 'CHI', 4_250_000, 2, 1, 2026, 'UFA', 'NHL', null, '1995-07-04'),
    c('Ilya Mikheyev', 'RW', 'CHI', 4_037_500, 2, 1, 2026, 'UFA', 'NHL', 'M-NTC', '1994-10-10'),
    c('Ryan Donato', 'LW', 'CHI', 4_000_000, 5, 4, 2029, 'UFA', 'NHL', 'M-NTC', '1996-04-09'),
    c('Sam Lafferty', 'RW', 'CHI', 2_000_000, 2, 1, 2026, 'UFA', 'NHL', null, '1995-03-06'),
    c('Connor Bedard', 'C', 'CHI', 950_000, 2, 1, 2026, 'RFA', 'NHL', null, '2005-07-17'),
    c('Frank Nazar', 'C', 'CHI', 950_000, 8, 8, 2033, 'UFA', 'NHL', 'M-NTC', '2004-01-14'),
    c('Ryan Greene', 'LW', 'CHI', 950_000, 3, 2, 2027, 'RFA', 'NHL', null, '2003-10-21'),
    c('Oliver Moore', 'LW', 'CHI', 941_667, 3, 2, 2027, 'RFA', 'NHL', null, '2005-01-22'),
    c('Landon Slaggert', 'RW', 'CHI', 900_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-06-25'),
    c('Colton Dach', 'LW', 'CHI', 825_000, 2, 1, 2026, 'RFA', 'NHL', null, '2003-01-04'),
    // --- Defense (Roster) ---
    c('Shea Weber', 'D', 'CHI', 7_857_143, 2, 1, 2026, 'UFA', 'IR', null),
    c('Ryan Ellis', 'D', 'CHI', 6_250_000, 3, 2, 2027, 'UFA', 'IR', null),
    c('Alex Vlasic', 'D', 'CHI', 4_600_000, 6, 5, 2030, 'UFA', 'NHL', 'M-NTC', '2001-06-05'),
    c('Connor Murphy', 'D', 'CHI', 4_400_000, 2, 1, 2026, 'UFA', 'NHL', 'M-NTC', '1993-03-26'),
    c('Wyatt Kaiser', 'D', 'CHI', 1_700_000, 2, 2, 2027, 'RFA', 'IR', null, '2002-07-31'),
    c('Matt Grzelcyk', 'D', 'CHI', 1_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1994-01-05'),
    c('Artyom Levshunov', 'D', 'CHI', 975_000, 3, 2, 2027, 'RFA', 'NHL', null, '2005-10-28'),
    c('Kevin Korchinski', 'D', 'CHI', 918_333, 2, 1, 2026, 'RFA', 'NHL', null, '2004-06-21'),
    c('Louis Crevier', 'D', 'CHI', 900_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-05-04'),
    // --- Goalies (Roster) ---
    c('Spencer Knight', 'G', 'CHI', 4_500_000, 5, 4, 2029, 'UFA', 'NHL', 'M-NTC', '2001-04-19'),
    c('Arvid Soderblom', 'G', 'CHI', 2_750_000, 3, 2, 2027, 'UFA', 'NHL', null, '1999-08-19'),
    // --- Dead Cap ---
    c('Seth Jones', 'D', 'CHI', 2_500_000, 5, 5, 2030, 'UFA', 'LTIR', 'NMC', '1994-10-03'),
    c('TJ Brodie', 'D', 'CHI', 3_233_333, 2, 2, 2027, 'UFA', 'AHL', null),
    // --- Non-Roster Forwards ---
    c('Anton Frondell', 'C', 'CHI', 975_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Marek Vanacker', 'LW', 'CHI', 942_500, 4, 3, 2028, 'RFA', 'AHL', null),
    c('Anthony Spellacy', 'RW', 'CHI', 906_667, 3, 2, 2027, 'RFA', 'AHL', null),
    c('Paul Ludwinski', 'C', 'CHI', 900_000, 3, 2, 2027, 'RFA', 'AHL', null),
    c('Aidan Thompson', 'C', 'CHI', 895_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Martin Misiak', 'RW', 'CHI', 878_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Gavin Hayes', 'LW', 'CHI', 865_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Nick Lardis', 'RW', 'CHI', 865_000, 4, 3, 2028, 'RFA', 'AHL', null),
    c('Dominic Toninato', 'C', 'CHI', 850_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Samuel Savoie', 'LW', 'CHI', 846_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Joey Anderson', 'RW', 'CHI', 800_000, 2, 1, 2026, 'UFA', 'AHL', null),
    // --- Non-Roster Defense ---
    c('Sam Rinzel', 'D', 'CHI', 941_667, 3, 2, 2027, 'RFA', 'NHL', null, '2004-06-25'),
    c('Taige Harding', 'D', 'CHI', 880_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Ethan Del Mastro', 'D', 'CHI', 855_833, 2, 1, 2026, 'RFA', 'AHL', null),
    c('Jake Furlong', 'D', 'CHI', 841_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Ryan Mast', 'D', 'CHI', 830_556, 2, 1, 2026, 'RFA', 'AHL', null),
    c('Dmitry Kuzmin', 'D', 'CHI', 795_556, 2, 1, 2026, 'RFA', 'AHL', null),
    // --- Non-Roster Goalies ---
    c('Stanislav Berezhnoy', 'G', 'CHI', 975_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Drew Commesso', 'G', 'CHI', 925_000, 2, 1, 2026, 'RFA', 'AHL', null),
  ],

  // =========================================================================
  // COL - Colorado Avalanche
  // =========================================================================
  'COL': [
    // --- Forwards (Roster) ---
    c('Nathan MacKinnon', 'C', 'COL', 12_600_000, 6, 6, 2031, 'UFA', 'NHL', 'NMC', '1995-09-01'),
    c('Brock Nelson', 'C', 'COL', 7_500_000, 3, 3, 2028, 'UFA', 'NHL', 'NTC', '1991-10-15'),
    c('Gabriel Landeskog', 'LW', 'COL', 7_000_000, 4, 4, 2029, 'UFA', 'LTIR', 'NMC', '1992-11-23'),
    c('Martin Necas', 'RW', 'COL', 6_500_000, 9, 9, 2034, 'UFA', 'NHL', 'NMC', '1999-01-15'),
    c('Valeri Nichushkin', 'RW', 'COL', 6_125_000, 5, 5, 2030, 'UFA', 'NHL', 'M-NTC', '1995-03-04'),
    c('Artturi Lehkonen', 'LW', 'COL', 4_500_000, 2, 2, 2027, 'UFA', 'NHL', 'M-NTC', '1995-07-04'),
    c('Ross Colton', 'LW', 'COL', 4_000_000, 2, 2, 2027, 'UFA', 'NHL', 'M-NTC', '1996-09-11'),
    c('Logan O\'Connor', 'RW', 'COL', 2_500_000, 6, 6, 2031, 'UFA', 'LTIR', 'M-NTC'),
    c('Jack Drury', 'C', 'COL', 1_725_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-02-03'),
    c('Victor Olofsson', 'RW', 'COL', 1_575_000, 1, 1, 2026, 'UFA', 'NHL', null, '1995-07-18'),
    c('Joel Kiviranta', 'RW', 'COL', 1_250_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-03-23'),
    c('Gavin Brindley', 'RW', 'COL', 950_000, 3, 3, 2028, 'RFA', 'NHL', null, '2004-10-05'),
    c('Zakhar Bardakov', 'C', 'COL', 867_500, 1, 1, 2026, 'RFA', 'NHL', null, '2001-02-24'),
    c('Parker Kelly', 'LW', 'COL', 825_000, 5, 5, 2030, 'UFA', 'NHL', null, '1999-05-14'),
    // --- Defense (Roster) ---
    c('Cale Makar', 'D', 'COL', 9_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-10-30'),
    c('Devon Toews', 'D', 'COL', 7_250_000, 6, 6, 2031, 'UFA', 'NHL', 'NMC', '1994-02-21'),
    c('Samuel Girard', 'D', 'COL', 5_000_000, 2, 2, 2027, 'UFA', 'NHL', 'M-NTC', '1998-05-12'),
    c('Josh Manson', 'D', 'COL', 4_500_000, 3, 3, 2028, 'UFA', 'NHL', 'M-NTC', '1991-10-07'),
    c('Sam Malinski', 'D', 'COL', 1_400_000, 5, 5, 2030, 'UFA', 'NHL', 'NTC', '1998-07-27'),
    c('Brent Burns', 'D', 'COL', 1_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1985-03-09'),
    // --- Goalies (Roster) ---
    c('Mackenzie Blackwood', 'G', 'COL', 5_250_000, 5, 5, 2030, 'UFA', 'NHL', 'M-NTC', '1996-12-09'),
    c('Scott Wedgewood', 'G', 'COL', 1_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1992-08-14'),
    // --- Non-Roster Forwards ---
    c('Taylor Makar', 'LW', 'COL', 925_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Chase Bradley', 'LW', 'COL', 872_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Cooper Gay', 'RW', 'COL', 872_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Ivan Ivan', 'C', 'COL', 845_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Nikita Prishchepov', 'C', 'COL', 806_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Matt Stienburg', 'C', 'COL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Tye Felhaber', 'LW', 'COL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Danil Gushchin', 'LW', 'COL', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Jason Polin', 'LW', 'COL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Tristen Nielsen', 'RW', 'COL', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('T.J. Tynan', 'C', 'COL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Alex Barre-Boulet', 'RW', 'COL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Valtteri Puustinen', 'RW', 'COL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // --- Non-Roster Defense ---
    c('Alex Gagne', 'D', 'COL', 910_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Sean Behrens', 'D', 'COL', 905_833, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Saige Weinstein', 'D', 'COL', 783_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Ronnie Attard', 'D', 'COL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Wyatt Aamodt', 'D', 'COL', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Jack Ahcan', 'D', 'COL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Keaton Middleton', 'D', 'COL', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Jacob MacDonald', 'D', 'COL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // --- Non-Roster Goalies ---
    c('Ilya Nabokov', 'G', 'COL', 975_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Isak Posch', 'G', 'COL', 872_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Trent Miner', 'G', 'COL', 775_000, 2, 2, 2027, 'RFA', 'AHL', null),
  ],

  // =========================================================================
  // DAL - Dallas Stars
  // =========================================================================
  'DAL': [
    // --- Forwards (Roster) ---
    c('Mikko Rantanen', 'RW', 'DAL', 12_000_000, 8, 8, 2033, 'UFA', 'NHL', 'NMC', '1996-10-29'),
    c('Roope Hintz', 'C', 'DAL', 8_450_000, 6, 6, 2031, 'UFA', 'NHL', 'NMC', '1996-11-17'),
    c('Wyatt Johnston', 'C', 'DAL', 8_400_000, 5, 5, 2030, 'UFA', 'NHL', null, '2003-05-14'),
    c('Jason Robertson', 'LW', 'DAL', 7_750_000, 1, 1, 2026, 'RFA', 'NHL', null, '1999-07-22'),
    c('Matt Duchene', 'C', 'DAL', 4_500_000, 4, 4, 2029, 'UFA', 'NHL', 'NMC', '1991-01-16'),
    c('Sam Steel', 'C', 'DAL', 2_100_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-02-03'),
    c('Radek Faksa', 'C', 'DAL', 2_000_000, 3, 3, 2028, 'UFA', 'NHL', 'M-NTC', '1994-01-09'),
    c('Jamie Benn', 'LW', 'DAL', 1_000_000, 1, 1, 2026, 'UFA', 'NHL', 'NMC', '1989-07-18'),
    c('Mavrik Bourque', 'RW', 'DAL', 950_000, 1, 1, 2026, 'RFA', 'NHL', null, '2002-01-08'),
    c('Justin Hryckowian', 'C', 'DAL', 870_000, 3, 3, 2028, 'UFA', 'NHL', null, '2001-02-23'),
    c('Oskar Back', 'C', 'DAL', 825_000, 2, 2, 2027, 'UFA', 'NHL', null),
    c('Colin Blackwell', 'RW', 'DAL', 775_000, 2, 2, 2027, 'UFA', 'NHL', null, '1993-03-28'),
    c('Adam Erne', 'LW', 'DAL', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1995-04-20'),
    c('Nathan Bastian', 'RW', 'DAL', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-12-06'),
    // --- Defense (Roster) ---
    c('Miro Heiskanen', 'D', 'DAL', 8_450_000, 4, 4, 2029, 'UFA', 'NHL', 'NMC', '1999-07-18'),
    c('Esa Lindell', 'D', 'DAL', 5_250_000, 5, 5, 2030, 'UFA', 'NHL', 'M-NTC', '1994-05-23'),
    c('Thomas Harley', 'D', 'DAL', 4_000_000, 9, 9, 2034, 'UFA', 'NHL', null, '2001-08-19'),
    c('Ilya Lyubushkin', 'D', 'DAL', 3_250_000, 2, 2, 2027, 'UFA', 'NHL', null, '1994-04-06'),
    c('Nils Lundkvist', 'D', 'DAL', 1_250_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-07-27'),
    c('Alexander Petrovic', 'D', 'DAL', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1992-03-03'),
    c('Kyle Capobianco', 'D', 'DAL', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-08-13'),
    // --- Goalies (Roster) ---
    c('Jake Oettinger', 'G', 'DAL', 8_250_000, 8, 8, 2033, 'UFA', 'NHL', 'NMC', '1998-12-18'),
    c('Casey DeSmith', 'G', 'DAL', 1_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1991-08-13'),
    // --- LTIR ---
    c('Tyler Seguin', 'C', 'DAL', 9_850_000, 2, 2, 2027, 'UFA', 'LTIR', 'NMC', '1992-01-31'),
    c('Lian Bichsel', 'D', 'DAL', 918_333, 2, 2, 2027, 'RFA', 'LTIR', null, '2004-05-18'),
    // --- Non-Roster Forwards ---
    c('Harrison Scott', 'C', 'DAL', 975_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Emil Hemming', 'RW', 'DAL', 942_500, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jaxon Fuder', 'C', 'DAL', 916_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Arttu Hyry', 'RW', 'DAL', 870_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Kyle McDonald', 'RW', 'DAL', 870_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Justin Ertel', 'LW', 'DAL', 867_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Ayrton Martino', 'LW', 'DAL', 867_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Chase Wheatcroft', 'C', 'DAL', 862_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Matthew Seminoff', 'RW', 'DAL', 850_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Angus MacDonell', 'C', 'DAL', 850_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Samu Tuomaala', 'RW', 'DAL', 830_833, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Francesco Arcuri', 'C', 'DAL', 825_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Antonio Stranges', 'LW', 'DAL', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Kole Lind', 'RW', 'DAL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Cameron Hughes', 'C', 'DAL', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    // --- Non-Roster Defense ---
    c('Trey Taylor', 'D', 'DAL', 975_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Connor Punnett', 'D', 'DAL', 870_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Luke Krys', 'D', 'DAL', 870_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Niilopekka Muhonen', 'D', 'DAL', 850_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Tristan Bertucci', 'D', 'DAL', 846_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Vladislav Kolyachonok', 'D', 'DAL', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Jeremie Poirier', 'D', 'DAL', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    // --- Non-Roster Goalies ---
    c('Arno Tiefensee', 'G', 'DAL', 850_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Ben Kraws', 'G', 'DAL', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Remi Poirier', 'G', 'DAL', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
  ],

  // =========================================================================
  // MIN - Minnesota Wild
  // =========================================================================
  'MIN': [
    // --- Forwards (Roster) ---
    c('Kirill Kaprizov', 'LW', 'MIN', 9_000_000, 9, 9, 2034, 'UFA', 'NHL', 'NMC', '1997-04-26'),
    c('Matt Boldy', 'RW', 'MIN', 7_000_000, 5, 5, 2030, 'UFA', 'NHL', 'M-NTC', '2001-04-05'),
    c('Joel Eriksson Ek', 'C', 'MIN', 5_250_000, 4, 4, 2029, 'UFA', 'NHL', 'NMC', '1997-01-29'),
    c('Vladimir Tarasenko', 'RW', 'MIN', 4_750_000, 1, 1, 2026, 'UFA', 'NHL', null, '1991-12-13'),
    c('Mats Zuccarello', 'RW', 'MIN', 4_125_000, 1, 1, 2026, 'UFA', 'NHL', 'NMC', '1987-09-01'),
    c('Marcus Foligno', 'LW', 'MIN', 4_000_000, 3, 3, 2028, 'UFA', 'NHL', 'NMC', '1991-08-10'),
    c('Ryan Hartman', 'C', 'MIN', 4_000_000, 2, 2, 2027, 'UFA', 'NHL', 'M-NTC', '1994-09-20'),
    c('Yakov Trenin', 'LW', 'MIN', 3_500_000, 3, 3, 2028, 'UFA', 'NHL', null, '1997-01-13'),
    c('Nico Sturm', 'C', 'MIN', 2_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1995-05-03'),
    c('Danila Yurov', 'C', 'MIN', 950_000, 3, 3, 2028, 'RFA', 'NHL', null, '2003-12-22'),
    c('Marcus Johansson', 'LW', 'MIN', 800_000, 1, 1, 2026, 'UFA', 'NHL', 'NTC', '1990-10-06'),
    c('Vinnie Hinostroza', 'RW', 'MIN', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1994-04-03'),
    c('Boris Katchouk', 'C', 'MIN', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-06-18'),
    // --- Defense (Roster) ---
    c('Brock Faber', 'D', 'MIN', 8_500_000, 8, 8, 2033, 'UFA', 'NHL', 'M-NTC', '2002-08-22'),
    c('Quinn Hughes', 'D', 'MIN', 7_850_000, 2, 2, 2027, 'UFA', 'NHL', null, '1999-10-14'),
    c('Jared Spurgeon', 'D', 'MIN', 7_575_000, 2, 2, 2027, 'UFA', 'NHL', 'M-NTC', '1989-11-29'),
    c('Jonas Brodin', 'D', 'MIN', 6_000_000, 3, 3, 2028, 'UFA', 'IR', 'NMC', '1993-07-12'),
    c('Jake Middleton', 'D', 'MIN', 4_350_000, 4, 4, 2029, 'UFA', 'NHL', 'NMC', '1996-01-02'),
    c('Zach Bogosian', 'D', 'MIN', 1_250_000, 1, 1, 2026, 'UFA', 'NHL', null, '1990-07-15'),
    c('Ben Gleason', 'D', 'MIN', 800_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-03-25'),
    c('Daemon Hunt', 'D', 'MIN', 775_000, 1, 1, 2026, 'RFA', 'NHL', null, '2002-05-15'),
    c('Matt Kiersted', 'D', 'MIN', 775_000, 2, 2, 2027, 'UFA', 'NHL', null),
    // --- Goalies (Roster) ---
    c('Filip Gustavsson', 'G', 'MIN', 3_750_000, 6, 6, 2031, 'UFA', 'NHL', null, '1998-06-07'),
    c('Jesper Wallstedt', 'G', 'MIN', 2_200_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-11-14'),
    // --- Dead Cap / Buyouts ---
    c('Zach Parise', 'LW', 'MIN', 833_333, 4, 4, 2029, 'UFA', 'NHL', null), // buyout - dead cap
    c('Ryan Suter', 'D', 'MIN', 833_333, 4, 4, 2029, 'UFA', 'NHL', null), // buyout - dead cap
    // --- Non-Roster Forwards ---
    c('Riley Heidt', 'C', 'MIN', 918_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Caedan Bankier', 'C', 'MIN', 867_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Rasmus Kumpulainen', 'C', 'MIN', 865_833, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Hunter Haight', 'C', 'MIN', 865_833, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Oskar Olausson', 'RW', 'MIN', 863_333, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Cameron Butler', 'RW', 'MIN', 858_333, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Bradley Marek', 'LW', 'MIN', 790_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Nicolas Aube-Kubel', 'RW', 'MIN', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Ben Jones', 'C', 'MIN', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Tyler Pitlick', 'RW', 'MIN', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    // --- Non-Roster Defense ---
    c('Jack Peart', 'D', 'MIN', 925_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('David Jiricek', 'D', 'MIN', 918_333, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Carson Lambos', 'D', 'MIN', 863_333, 1, 1, 2026, 'RFA', 'AHL', null),
    c('David Spacek', 'D', 'MIN', 862_500, 1, 1, 2026, 'RFA', 'AHL', null, '2003-02-18'),
    c('Stevie Leskovar', 'D', 'MIN', 860_000, 3, 3, 2028, 'RFA', 'AHL', null),
    // --- Non-Roster Goalies ---
    c('Chase Wutzke', 'G', 'MIN', 962_500, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Samuel Hlavaj', 'G', 'MIN', 875_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Riley Mercer', 'G', 'MIN', 819_167, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Cal Petersen', 'G', 'MIN', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
  ],

  // =========================================================================
  // NSH - Nashville Predators
  // =========================================================================
  'NSH': [
    // --- Forwards (Roster) ---
    c('Filip Forsberg', 'LW', 'NSH', 8_500_000, 5, 5, 2030, 'UFA', 'NHL', 'NMC', '1994-08-13'),
    c('Steven Stamkos', 'RW', 'NSH', 8_000_000, 3, 3, 2028, 'UFA', 'NHL', 'NMC', '1990-02-07'),
    c('Jonathan Marchessault', 'RW', 'NSH', 5_500_000, 4, 4, 2029, 'UFA', 'NHL', 'M-NTC', '1990-12-27'),
    c('Ryan O\'Reilly', 'C', 'NSH', 4_500_000, 2, 2, 2027, 'UFA', 'NHL', null),
    c('Michael Bunting', 'LW', 'NSH', 4_500_000, 1, 1, 2026, 'UFA', 'NHL', null, '1995-09-17'),
    c('Erik Haula', 'C', 'NSH', 3_150_000, 1, 1, 2026, 'UFA', 'NHL', 'M-NTC', '1991-03-23'),
    c('Luke Evangelista', 'RW', 'NSH', 3_000_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-02-21'),
    c('Cole Smith', 'LW', 'NSH', 1_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1995-10-28'),
    c('Michael McCarron', 'C', 'NSH', 900_000, 1, 1, 2026, 'UFA', 'NHL', null, '1995-03-07'),
    c('Tyson Jost', 'LW', 'NSH', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-03-14'),
    c('Ozzy Wiesblatt', 'RW', 'NSH', 775_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-03-09'),
    // --- Defense (Roster) ---
    c('Roman Josi', 'D', 'NSH', 9_059_000, 3, 3, 2028, 'UFA', 'NHL', 'NMC', '1990-06-01'),
    c('Brady Skjei', 'D', 'NSH', 7_000_000, 6, 6, 2031, 'UFA', 'NHL', 'NMC', '1994-03-26'),
    c('Nicolas Hague', 'D', 'NSH', 5_500_000, 4, 4, 2029, 'UFA', 'NHL', null, '1998-12-05'),
    c('Nick Perbix', 'D', 'NSH', 2_750_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-06-15'),
    c('Justin Barron', 'D', 'NSH', 1_150_000, 1, 1, 2026, 'RFA', 'NHL', null, '2001-11-15'),
    c('Nick Blankenburg', 'D', 'NSH', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-05-12'),
    c('Adam Wilsby', 'D', 'NSH', 775_000, 2, 2, 2027, 'RFA', 'NHL', null, '2000-08-07'),
    // --- Goalies (Roster) ---
    c('Juuse Saros', 'G', 'NSH', 7_740_000, 8, 8, 2033, 'UFA', 'NHL', 'NMC', '1995-04-19'),
    c('Justus Annunen', 'G', 'NSH', 837_500, 3, 3, 2028, 'UFA', 'NHL', null, '2000-03-11'),
    c('Matt Murray', 'G', 'NSH', 775_000, 2, 2, 2027, 'UFA', 'NHL', null, '1994-05-25'),
    // --- Dead Cap (Retained Salary) ---
    c('Colton Sissons', 'C', 'NSH', 1_428_572, 1, 1, 2026, 'UFA', 'NHL', null, '1993-11-05'), // retained salary
    c('Mattias Ekholm', 'D', 'NSH', 250_000, 1, 1, 2026, 'UFA', 'NHL', null, '1990-05-24'), // retained salary
    // --- Dead Cap (Buyouts) ---
    c('Matt Duchene', 'C', 'NSH', 6_555_556, 4, 4, 2029, 'UFA', 'NHL', null, '1991-01-16'), // buyout dead cap
    c('Kyle Turris', 'C', 'NSH', 2_000_000, 3, 3, 2028, 'UFA', 'NHL', null), // buyout dead cap
    // --- Non-Roster Forwards ---
    c('Brady Martin', 'C', 'NSH', 975_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Matthew Wood', 'RW', 'NSH', 950_000, 3, 2, 2027, 'RFA', 'AHL', null),
    c('Fedor Svechkov', 'C', 'NSH', 925_000, 2, 1, 2026, 'RFA', 'AHL', null),
    c('Ryder Rolston', 'RW', 'NSH', 895_000, 2, 1, 2026, 'RFA', 'AHL', null),
    c('David Edstrom', 'C', 'NSH', 886_667, 4, 3, 2028, 'RFA', 'AHL', null),
    c('Joakim Kemell', 'RW', 'NSH', 886_667, 3, 2, 2027, 'RFA', 'AHL', null),
    c('Reid Schaefer', 'LW', 'NSH', 886_667, 3, 2, 2027, 'RFA', 'AHL', null),
    c('Zachary L\'Heureux', 'LW', 'NSH', 863_333, 2, 1, 2026, 'RFA', 'AHL', null),
    c('Joey Willis', 'C', 'NSH', 860_000, 3, 2, 2027, 'RFA', 'AHL', null),
    c('Cole O\'Hara', 'RW', 'NSH', 860_000, 2, 1, 2026, 'RFA', 'AHL', null),
    c('Austin Roest', 'RW', 'NSH', 845_000, 3, 2, 2027, 'RFA', 'AHL', null),
    c('Hiroki Gojsic', 'RW', 'NSH', 835_000, 4, 3, 2028, 'RFA', 'AHL', null),
    c('Kalan Lind', 'LW', 'NSH', 806_667, 4, 3, 2028, 'RFA', 'AHL', null),
    c('Jacob Lucchini', 'C', 'NSH', 775_000, 2, 1, 2026, 'UFA', 'AHL', null),
    c('Navrin Mutter', 'LW', 'NSH', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // --- Non-Roster Defense ---
    c('Ryan Ufko', 'D', 'NSH', 925_000, 3, 2, 2027, 'RFA', 'AHL', null),
    c('Tanner Molendyk', 'D', 'NSH', 886_667, 4, 3, 2028, 'RFA', 'AHL', null),
    c('Andrew Gibson', 'D', 'NSH', 865_000, 4, 3, 2028, 'RFA', 'AHL', null),
    c('Jack Matier', 'D', 'NSH', 801_667, 2, 1, 2026, 'RFA', 'AHL', null),
    c('Jordan Oesterle', 'D', 'NSH', 775_000, 2, 1, 2026, 'UFA', 'AHL', null),
    c('Kevin Gravel', 'D', 'NSH', 775_000, 2, 1, 2026, 'UFA', 'AHL', null),
    c('Andreas Englund', 'D', 'NSH', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // --- Non-Roster Goalies ---
    c('Magnus Chrona', 'G', 'NSH', 855_000, 2, 1, 2026, 'UFA', 'AHL', null),
  ],

  // =========================================================================
  // STL - St. Louis Blues
  // =========================================================================
  'STL': [
    // --- Forwards (Roster) ---
    c('Jordan Kyrou', 'RW', 'STL', 8_125_000, 7, 6, 2031, 'UFA', 'NHL', 'NTC', '1998-05-05'),
    c('Robert Thomas', 'C', 'STL', 8_125_000, 7, 6, 2031, 'UFA', 'IR', 'NTC', '1999-07-02'),
    c('Pavel Buchnevich', 'LW', 'STL', 8_000_000, 6, 6, 2031, 'UFA', 'NHL', 'NTC', '1995-04-17'),
    c('Brayden Schenn', 'C', 'STL', 6_500_000, 4, 3, 2028, 'UFA', 'NHL', 'M-NTC', '1991-08-22'),
    c('Pius Suter', 'C', 'STL', 4_125_000, 2, 2, 2027, 'UFA', 'NHL', null, '1996-05-24'),
    c('Jake Neighbours', 'LW', 'STL', 3_750_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-03-29'),
    c('Mathieu Joseph', 'RW', 'STL', 2_950_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-02-09'),
    c('Dylan Holloway', 'LW', 'STL', 2_290_457, 2, 1, 2026, 'RFA', 'IR', null, '2001-09-23'),
    c('Jonatan Berggren', 'RW', 'STL', 1_825_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-07-16'),
    c('Alexey Toropchenko', 'LW', 'STL', 1_700_000, 3, 3, 2028, 'UFA', 'NHL', null, '1999-06-25'),
    c('Oskar Sundqvist', 'C', 'STL', 1_500_000, 2, 1, 2026, 'UFA', 'NHL', null, '1994-03-23'),
    c('Jimmy Snuggerud', 'RW', 'STL', 950_000, 3, 2, 2027, 'RFA', 'NHL', null, '2004-06-01'),
    c('Dalibor Dvorsky', 'C', 'STL', 886_667, 4, 3, 2028, 'RFA', 'NHL', null, '2005-06-15'),
    c('Nathan Walker', 'RW', 'STL', 775_000, 3, 3, 2028, 'UFA', 'NHL', null, '1994-02-07'),
    c('Robby Fabbri', 'RW', 'STL', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-01-22'),
    c('Jack Finley', 'C', 'STL', 775_000, 3, 3, 2028, 'RFA', 'NHL', null, '2002-09-02'),
    // --- Defense (Roster) ---
    c('Colton Parayko', 'D', 'STL', 6_500_000, 6, 5, 2030, 'UFA', 'NHL', 'NTC', '1993-05-12'),
    c('Justin Faulk', 'D', 'STL', 6_500_000, 3, 2, 2027, 'UFA', 'NHL', 'M-NTC', '1992-03-20'),
    c('Philip Broberg', 'D', 'STL', 4_580_917, 7, 7, 2032, 'UFA', 'NHL', null, '2001-06-25'),
    c('Cam Fowler', 'D', 'STL', 4_000_000, 4, 4, 2029, 'UFA', 'NHL', 'M-NTC', '1991-12-05'),
    c('Tyler Tucker', 'D', 'STL', 925_000, 2, 2, 2027, 'UFA', 'NHL', null, '2000-03-01'),
    c('Logan Mailloux', 'D', 'STL', 875_000, 2, 2, 2027, 'RFA', 'NHL', null, '2003-04-15'),
    c('Matthew Kessel', 'D', 'STL', 800_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-06-23'),
    // --- Goalies (Roster) ---
    c('Jordan Binnington', 'G', 'STL', 6_000_000, 3, 2, 2027, 'UFA', 'NHL', 'NTC', '1993-07-11'),
    c('Joel Hofer', 'G', 'STL', 3_400_000, 2, 2, 2027, 'RFA', 'NHL', null, '2000-07-30'),
    c('Georgi Romanov', 'G', 'STL', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1999-12-15'),
    // --- LTIR ---
    c('Torey Krug', 'D', 'STL', 3_817_293, 3, 2, 2027, 'UFA', 'LTIR', 'NTC'),
    // --- Non-Roster Forwards ---
    c('Justin Carbonneau', 'RW', 'STL', 975_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Otto Stenberg', 'LW', 'STL', 918_333, 4, 3, 2028, 'RFA', 'AHL', null),
    c('Adam Jecho', 'C', 'STL', 872_500, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Aleksanteri Kaskimaki', 'LW', 'STL', 870_000, 3, 2, 2027, 'RFA', 'AHL', null),
    c('Dylan Peterson', 'C', 'STL', 867_500, 2, 2, 2026, 'RFA', 'AHL', null),
    c('Simon Robertsson', 'RW', 'STL', 867_500, 3, 3, 2027, 'RFA', 'AHL', null),
    c('Nikita Susuyev', 'RW', 'STL', 855_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Zach Dean', 'C', 'STL', 852_500, 2, 2, 2026, 'RFA', 'AHL', null),
    c('Juraj Pekarcik', 'LW', 'STL', 838_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jakub Stancl', 'C', 'STL', 835_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Akil Thomas', 'C', 'STL', 775_000, 2, 2, 2026, 'UFA', 'AHL', null),
    c('Hugh McGing', 'LW', 'STL', 775_000, 2, 2, 2026, 'UFA', 'AHL', null),
    c('Matt Luff', 'RW', 'STL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Thomas Bordeleau', 'C', 'STL', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    // --- Non-Roster Defense ---
    c('Adam Jiricek', 'D', 'STL', 942_500, 4, 4, 2029, 'RFA', 'AHL', null),
    c('Lukas Fischer', 'D', 'STL', 931_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Theo Lindstein', 'D', 'STL', 918_333, 4, 4, 2029, 'RFA', 'AHL', null),
    c('Leo Loof', 'D', 'STL', 867_500, 2, 2, 2026, 'RFA', 'AHL', null),
    c('Michael Buchinger', 'D', 'STL', 838_333, 3, 3, 2027, 'RFA', 'AHL', null),
    c('Quinton Burns', 'D', 'STL', 838_333, 4, 4, 2029, 'RFA', 'AHL', null),
    c('Marc-Andre Gaudet', 'D', 'STL', 802_500, 3, 3, 2027, 'RFA', 'AHL', null),
    c('Calle Rosen', 'D', 'STL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Hunter Skinner', 'D', 'STL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // --- Non-Roster Goalies ---
    c('Vadim Zherenko', 'G', 'STL', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Will Cranley', 'G', 'STL', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
  ],

  // =========================================================================
  // WPG - Winnipeg Jets
  // =========================================================================
  'WPG': [
    // --- Forwards (Roster) ---
    c('Kyle Connor', 'LW', 'WPG', 12_000_000, 9, 9, 2034, 'UFA', 'NHL', 'M-NTC', '1996-12-09'),
    c('Mark Scheifele', 'C', 'WPG', 8_500_000, 6, 6, 2031, 'UFA', 'NHL', 'NMC', '1993-03-15'),
    c('Gabriel Vilardi', 'C', 'WPG', 7_500_000, 6, 6, 2031, 'UFA', 'NHL', null, '1999-08-16'),
    c('Adam Lowry', 'C', 'WPG', 5_000_000, 6, 6, 2031, 'UFA', 'NHL', 'M-NTC', '1993-03-29'),
    c('Nino Niederreiter', 'LW', 'WPG', 4_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1992-09-08'),
    c('Alex Iafallo', 'RW', 'WPG', 3_666_667, 3, 3, 2028, 'UFA', 'NHL', null, '1993-12-21'),
    c('Cole Perfetti', 'LW', 'WPG', 3_250_000, 1, 1, 2026, 'RFA', 'NHL', null, '2002-01-01'),
    c('Gustav Nyquist', 'RW', 'WPG', 3_250_000, 1, 1, 2026, 'UFA', 'NHL', null, '1989-09-01'),
    c('Vladislav Namestnikov', 'C', 'WPG', 3_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1992-11-22'),
    c('Jonathan Toews', 'C', 'WPG', 2_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1988-04-29'),
    c('Morgan Barron', 'C', 'WPG', 1_850_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-12-02'),
    c('Cole Koepke', 'LW', 'WPG', 1_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-05-17'),
    c('Tanner Pearson', 'RW', 'WPG', 1_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1992-08-10'),
    c('Walker Duehr', 'RW', 'WPG', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-11-23'),
    // --- Defense (Roster) ---
    c('Neal Pionk', 'D', 'WPG', 7_000_000, 6, 6, 2031, 'UFA', 'IR', 'M-NTC', '1995-07-29'),
    c('Josh Morrissey', 'D', 'WPG', 6_250_000, 3, 3, 2028, 'UFA', 'IR', 'M-NTC'),
    c('Dylan Samberg', 'D', 'WPG', 5_750_000, 3, 3, 2028, 'UFA', 'NHL', null, '1999-01-24'),
    c('Dylan DeMelo', 'D', 'WPG', 4_900_000, 3, 3, 2028, 'UFA', 'NHL', null, '1993-05-01'),
    c('Luke Schenn', 'D', 'WPG', 2_750_000, 1, 1, 2026, 'UFA', 'NHL', null, '1989-11-02'),
    c('Colin Miller', 'D', 'WPG', 1_500_000, 1, 1, 2026, 'UFA', 'IR', null, '1992-10-29'),
    c('Logan Stanley', 'D', 'WPG', 1_250_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-05-26'),
    c('Haydn Fleury', 'D', 'WPG', 950_000, 2, 2, 2027, 'UFA', 'IR', null, '1996-07-08'),
    c('Elias Salomonsson', 'D', 'WPG', 895_000, 2, 2, 2027, 'RFA', 'NHL', null, '2004-08-31'),
    c('Ville Heinola', 'D', 'WPG', 800_000, 1, 1, 2026, 'UFA', 'NHL', null, '2001-03-02'),
    // --- Goalies (Roster) ---
    c('Connor Hellebuyck', 'G', 'WPG', 8_500_000, 6, 6, 2031, 'UFA', 'NHL', 'NMC', '1993-05-19'),
    c('Domenic DiVincentiis', 'G', 'WPG', 830_556, 2, 2, 2027, 'RFA', 'NHL', null, '2004-03-04'),
    c('Eric Comrie', 'G', 'WPG', 825_000, 1, 1, 2026, 'UFA', 'NHL', null, '1995-07-06'),
    // --- Dead Cap (Buyout) ---
    c('Nate Schmidt', 'D', 'WPG', 1_616_667, 1, 1, 2026, 'UFA', 'NHL', null, '1991-07-16'), // buyout dead cap
    // --- Non-Roster Forwards ---
    c('Brayden Yager', 'C', 'WPG', 918_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jacob Julien', 'C', 'WPG', 895_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Colby Barlow', 'LW', 'WPG', 886_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Brad Lambert', 'RW', 'WPG', 886_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Nikita Chibrikov', 'RW', 'WPG', 875_833, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Kieron Walton', 'C', 'WPG', 858_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Kevin He', 'LW', 'WPG', 840_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('David Gustafsson', 'C', 'WPG', 835_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Fabian Wagner', 'C', 'WPG', 830_556, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Parker Ford', 'C', 'WPG', 812_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Danil Zhilkin', 'C', 'WPG', 803_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Mason Shaw', 'C', 'WPG', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Phillip Di Giuseppe', 'LW', 'WPG', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Jaret Anderson-Dolan', 'C', 'WPG', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Samuel Fagemo', 'LW', 'WPG', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // --- Non-Roster Defense ---
    c('Alfons Freij', 'D', 'WPG', 905_833, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Isaak Phillips', 'D', 'WPG', 812_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Tyrel Bauer', 'D', 'WPG', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Kale Clague', 'D', 'WPG', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // --- Non-Roster Goalies ---
    c('Thomas Milic', 'G', 'WPG', 841_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Isaac Poulter', 'G', 'WPG', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
  ],

  // ============================================================
  // ANA - Anaheim Ducks
  // ============================================================
  'ANA': [
    // Forwards
    c('Mason McTavish', 'C', 'ANA', 7_000_000, 6, 6, 2031, 'UFA', 'NHL', null, '2003-01-30'),
    c('Troy Terry', 'RW', 'ANA', 7_000_000, 5, 5, 2030, 'UFA', 'NHL', null, '1997-09-10'),
    c('Mikael Granlund', 'C', 'ANA', 7_000_000, 3, 3, 2028, 'UFA', 'NHL', null, '1992-02-26'),
    c('Chris Kreider', 'LW', 'ANA', 6_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1991-04-30'),
    c('Alex Killorn', 'RW', 'ANA', 6_250_000, 2, 2, 2027, 'UFA', 'NHL', null, '1989-09-14'),
    c('Ryan Strome', 'C', 'ANA', 5_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1993-07-11'),
    c('Frank Vatrano', 'LW', 'ANA', 4_571_189, 3, 3, 2028, 'UFA', 'IR', null, '1994-03-14'),
    c('Ryan Poehling', 'C', 'ANA', 1_900_000, 1, 1, 2026, 'UFA', 'NHL', null, '1999-01-03'),
    c('Ross Johnston', 'LW', 'ANA', 1_100_000, 1, 1, 2026, 'UFA', 'NHL', null, '1994-02-18'),
    c('Cutter Gauthier', 'LW', 'ANA', 950_000, 1, 1, 2026, 'RFA', 'NHL', null, '2004-01-19'),
    c('Leo Carlsson', 'C', 'ANA', 950_000, 1, 1, 2026, 'RFA', 'IR', null, '2004-12-26'),
    c('Beckett Sennecke', 'RW', 'ANA', 942_500, 3, 3, 2028, 'RFA', 'NHL', null, '2006-01-28'),
    c('Jansen Harkins', 'C', 'ANA', 787_500, 1, 1, 2026, 'UFA', 'NHL', null, '1997-05-23'),
    c('Jeffrey Viel', 'LW', 'ANA', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-01-28'),
    // Defense
    c('Jacob Trouba', 'D', 'ANA', 8_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1994-02-26'),
    c('Jackson LaCombe', 'D', 'ANA', 9_000_000, 9, 9, 2034, 'UFA', 'NHL', null, '2001-01-09'),
    c('Radko Gudas', 'D', 'ANA', 4_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1990-06-05'),
    c('Drew Helleson', 'D', 'ANA', 1_100_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-03-26'),
    c('Pavel Mintyukov', 'D', 'ANA', 918_333, 1, 1, 2026, 'RFA', 'NHL', null, '2003-11-25'),
    c('Olen Zellweger', 'D', 'ANA', 844_167, 1, 1, 2026, 'RFA', 'NHL', null, '2003-09-10'),
    // Goalies
    c('Lukas Dostal', 'G', 'ANA', 6_500_000, 5, 5, 2030, 'UFA', 'NHL', null, '2000-06-22'),
    c('Petr Mrazek', 'G', 'ANA', 4_250_000, 1, 1, 2026, 'UFA', 'IR', null, '1992-02-14'),
    c('Ville Husso', 'G', 'ANA', 2_200_000, 2, 2, 2027, 'UFA', 'NHL', null, '1995-02-06'),
    // Non-Roster Forwards (AHL)
    c('Nico Myatovic', 'LW', 'ANA', 896_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Nathan Gaucher', 'C', 'ANA', 886_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Lucas Pettersson', 'C', 'ANA', 869_050, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Yegor Sidorov', 'RW', 'ANA', 865_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Coulson Pitre', 'RW', 'ANA', 860_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Jaxsen Wiebe', 'RW', 'ANA', 852_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Sam Colangelo', 'RW', 'ANA', 850_000, 2, 2, 2027, 'RFA', 'AHL', null, '2001-12-26'),
    c('Sasha Pastujov', 'RW', 'ANA', 825_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Tim Washe', 'C', 'ANA', 812_500, 2, 2, 2027, 'RFA', 'AHL', null, '2001-08-25'),
    c('Nikita Nesterenko', 'LW', 'ANA', 787_500, 2, 2, 2027, 'RFA', 'AHL', null, '2001-09-10'),
    c('Jan Mysak', 'C', 'ANA', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    // Non-Roster Defense (AHL)
    c('Stian Solberg', 'D', 'ANA', 942_500, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Ian Moore', 'D', 'ANA', 925_000, 1, 1, 2026, 'RFA', 'AHL', null, '2002-01-04'),
    c('Noah Warren', 'D', 'ANA', 865_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Tristan Luneau', 'D', 'ANA', 865_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Konnor Smith', 'D', 'ANA', 855_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Tyson Hinds', 'D', 'ANA', 829_444, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Jeremie Biakabutuka', 'D', 'ANA', 825_000, 1, 1, 2026, 'RFA', 'AHL', null),
    // Non-Roster Goalies (AHL)
    c('Tomas Suchanek', 'G', 'ANA', 870_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Vyacheslav Buteyets', 'G', 'ANA', 852_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Damian Clara', 'G', 'ANA', 846_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Calle Clang', 'G', 'ANA', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
  ],

  // ============================================================
  // CGY - Calgary Flames
  // ============================================================
  'CGY': [
    // Forwards
    c('Jonathan Huberdeau', 'LW', 'CGY', 10_500_000, 6, 6, 2031, 'UFA', 'IR', 'NMC', '1993-06-04'),
    c('Nazem Kadri', 'C', 'CGY', 7_000_000, 4, 4, 2029, 'UFA', 'NHL', 'M-NTC', '1990-10-06'),
    c('Matt Coronato', 'RW', 'CGY', 6_500_000, 7, 7, 2032, 'UFA', 'NHL', null, '2002-11-14'),
    c('Yegor Sharangovich', 'C', 'CGY', 5_750_000, 5, 5, 2030, 'UFA', 'NHL', null, '1998-06-06'),
    c('Joel Farabee', 'RW', 'CGY', 5_000_000, 3, 3, 2028, 'UFA', 'NHL', null, '2000-02-25'),
    c('Blake Coleman', 'RW', 'CGY', 4_900_000, 2, 2, 2027, 'UFA', 'IR', null, '1991-11-28'),
    c('Mikael Backlund', 'C', 'CGY', 4_500_000, 3, 3, 2028, 'UFA', 'NHL', null, '1989-03-17'),
    c('Morgan Frost', 'C', 'CGY', 4_375_000, 2, 2, 2027, 'UFA', 'NHL', null, '1999-05-14'),
    c('Connor Zary', 'C', 'CGY', 3_775_000, 3, 3, 2028, 'RFA', 'NHL', null, '2001-09-25'),
    c('Ryan Lomberg', 'LW', 'CGY', 2_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1994-12-09'),
    c('Adam Klapka', 'RW', 'CGY', 1_250_000, 2, 2, 2027, 'RFA', 'NHL', null, '2000-09-14'),
    c('Martin Pospisil', 'C', 'CGY', 1_000_000, 4, 4, 2029, 'UFA', 'NHL', null, '1999-11-19'),
    c('Matvei Gridin', 'RW', 'CGY', 942_500, 3, 3, 2028, 'RFA', 'NHL', null, '2006-03-01'),
    c('John Beecher', 'C', 'CGY', 900_000, 1, 1, 2026, 'RFA', 'IR', null, '2001-04-05'),
    c('Samuel Honzek', 'LW', 'CGY', 886_667, 3, 3, 2028, 'RFA', 'IR', null, '2004-11-12'),
    // Defense
    c('MacKenzie Weegar', 'D', 'CGY', 6_250_000, 6, 6, 2031, 'UFA', 'NHL', 'M-NTC', '1994-01-07'),
    c('Kevin Bahl', 'D', 'CGY', 5_350_000, 6, 6, 2031, 'UFA', 'NHL', null, '2000-06-27'),
    c('Zach Whitecloud', 'D', 'CGY', 2_750_000, 3, 3, 2028, 'UFA', 'NHL', null, '1996-11-28'),
    c('Jake Bean', 'D', 'CGY', 1_750_000, 1, 1, 2026, 'UFA', 'IR', null, '1998-06-09'),
    c('Joel Hanley', 'D', 'CGY', 1_750_000, 2, 2, 2027, 'UFA', 'NHL', null, '1991-06-08'),
    c('Brayden Pachal', 'D', 'CGY', 1_187_500, 2, 2, 2027, 'RFA', 'NHL', null, '1999-08-23'),
    c('Zayne Parekh', 'D', 'CGY', 942_500, 3, 3, 2028, 'RFA', 'NHL', null, '2006-02-15'),
    c('Yan Kuznetsov', 'D', 'CGY', 812_500, 2, 2, 2027, 'RFA', 'NHL', null, '2002-03-09'),
    // Goalies
    c('Dustin Wolf', 'G', 'CGY', 850_000, 8, 8, 2033, 'UFA', 'NHL', null, '2001-04-16'),
    c('Devin Cooley', 'G', 'CGY', 775_000, 3, 3, 2028, 'UFA', 'NHL', null, '1997-05-25'),
    // Non-Roster Forwards (AHL)
    c('Jacob Battaglia', 'RW', 'CGY', 931_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Aydar Suniev', 'LW', 'CGY', 923_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('William Stromgren', 'RW', 'CGY', 900_833, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Justin Kirkland', 'C', 'CGY', 900_000, 1, 1, 2026, 'UFA', 'AHL', null, '1996-08-02'),
    c('Carter King', 'C', 'CGY', 872_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Andrew Basha', 'LW', 'CGY', 865_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Parker Bell', 'LW', 'CGY', 857_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Lucas Ciona', 'LW', 'CGY', 830_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Dryden Hunt', 'LW', 'CGY', 825_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Clark Bishop', 'C', 'CGY', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Rory Kerins', 'LW', 'CGY', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Sam Morton', 'C', 'CGY', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    // Non-Roster Defense (AHL)
    c('Hunter Brzustewicz', 'D', 'CGY', 950_000, 2, 2, 2027, 'RFA', 'AHL', null, '2004-11-29'),
    c('Etienne Morin', 'D', 'CGY', 871_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Gavin White', 'D', 'CGY', 857_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Artem Grushnikov', 'D', 'CGY', 814_167, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Nick Cicek', 'D', 'CGY', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Daniil Miromanov', 'D', 'CGY', 100_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Non-Roster Goalies (AHL)
    c('Ivan Prosvetov', 'G', 'CGY', 950_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Owen Say', 'G', 'CGY', 872_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Arsenii Sergeev', 'G', 'CGY', 866_250, 2, 2, 2027, 'RFA', 'AHL', null),
    // Dead Cap (retained salary on traded players)
    // Rasmus Andersson: $2,275,000 retained (50% - traded to VGK)
    // Jacob Markstrom: $1,875,000 retained (31.25% - traded to NJD)
  ],

  // ============================================================
  // EDM - Edmonton Oilers
  // ============================================================
  'EDM': [
    // Forwards
    c('Leon Draisaitl', 'C', 'EDM', 14_000_000, 8, 8, 2033, 'UFA', 'NHL', 'NMC', '1995-10-27'),
    c('Connor McDavid', 'C', 'EDM', 12_500_000, 3, 3, 2028, 'UFA', 'NHL', 'NMC', '1997-01-13'),
    c('Zach Hyman', 'RW', 'EDM', 5_500_000, 3, 3, 2028, 'UFA', 'NHL', 'M-NTC', '1992-06-09'),
    c('Ryan Nugent-Hopkins', 'C', 'EDM', 5_125_000, 4, 4, 2029, 'UFA', 'NHL', 'M-NTC', '1993-04-12'),
    c('Trent Frederic', 'RW', 'EDM', 3_850_000, 8, 8, 2033, 'UFA', 'NHL', null, '1998-02-11'),
    c('Andrew Mangiapane', 'LW', 'EDM', 3_600_000, 2, 2, 2027, 'UFA', 'NHL', null, '1996-04-04'),
    c('Jack Roslovic', 'RW', 'EDM', 1_500_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-01-29'),
    c('Mattias Janmark', 'LW', 'EDM', 1_450_000, 2, 2, 2027, 'UFA', 'NHL', null, '1992-12-08'),
    c('Kasperi Kapanen', 'RW', 'EDM', 1_300_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-07-23'),
    c('Vasily Podkolzin', 'LW', 'EDM', 1_000_000, 4, 4, 2029, 'UFA', 'NHL', null, '2001-06-24'),
    c('Curtis Lazar', 'C', 'EDM', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1995-02-02'),
    c('Adam Henrique', 'C', 'EDM', 3_000_000, 1, 1, 2026, 'UFA', 'LTIR', null, '1990-02-06'),
    // Defense
    c('Evan Bouchard', 'D', 'EDM', 10_500_000, 4, 4, 2029, 'UFA', 'NHL', null, '1999-10-20'),
    c('Darnell Nurse', 'D', 'EDM', 9_250_000, 5, 5, 2030, 'UFA', 'NHL', 'NMC', '1995-02-04'),
    c('Jake Walman', 'D', 'EDM', 7_000_000, 8, 8, 2033, 'UFA', 'NHL', null, '1996-02-20'),
    c('Mattias Ekholm', 'D', 'EDM', 4_000_000, 3, 3, 2029, 'UFA', 'NHL', 'NTC', '1990-05-24'),
    c('Ty Emberson', 'D', 'EDM', 1_300_000, 2, 2, 2027, 'UFA', 'NHL', null, '2000-05-23'),
    c('Spencer Stastney', 'D', 'EDM', 825_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-01-04'),
    // Goalies
    c('Tristan Jarry', 'G', 'EDM', 5_375_000, 3, 3, 2028, 'UFA', 'NHL', null, '1995-04-29'),
    c('Connor Ingram', 'G', 'EDM', 1_150_500, 1, 1, 2026, 'UFA', 'NHL', null, '1997-03-31'),
    // Non-Roster Forwards (AHL)
    c('Max Jones', 'LW', 'EDM', 1_000_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Josh Samanski', 'C', 'EDM', 975_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Isaac Howard', 'LW', 'EDM', 950_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Matt Savoie', 'RW', 'EDM', 886_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Quinn Hutson', 'RW', 'EDM', 875_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Viljami Marjala', 'LW', 'EDM', 872_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('James Stefan', 'RW', 'EDM', 870_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Jayden Grubbe', 'C', 'EDM', 867_500, 2, 2, 2026, 'RFA', 'AHL', null),
    c('Connor Clattenburg', 'LW', 'EDM', 828_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Brady Stonehouse', 'RW', 'EDM', 821_667, 3, 3, 2027, 'RFA', 'AHL', null),
    c('Matvey Petrov', 'LW', 'EDM', 803_333, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Roby Jarventie', 'LW', 'EDM', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('James Hamblin', 'LW', 'EDM', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Sam Poulin', 'RW', 'EDM', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Non-Roster Defense (AHL)
    c('Josh Brown', 'D', 'EDM', 1_000_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Damien Carfagna', 'D', 'EDM', 862_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Atro Leppanen', 'D', 'EDM', 850_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Beau Akey', 'D', 'EDM', 831_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Cam Dineen', 'D', 'EDM', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Riley Stillman', 'D', 'EDM', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Alec Regula', 'D', 'EDM', 775_000, 2, 2, 2027, 'RFA', 'AHL', null, '2000-08-06'),
    // Non-Roster Goalies (AHL)
    c('Calvin Pickard', 'G', 'EDM', 1_000_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Connor Ungar', 'G', 'EDM', 860_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Nathaniel Day', 'G', 'EDM', 856_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Samuel Jonsson', 'G', 'EDM', 855_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Matt Tomkins', 'G', 'EDM', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    // Dead Cap / Buyout
    // Jack Campbell: $2,300,000 buyout cap hit through 2030
  ],

  // ============================================================
  // LAK - Los Angeles Kings
  // ============================================================
  'LAK': [
    // Forwards
    c('Kevin Fiala', 'LW', 'LAK', 7_875_000, 4, 4, 2029, 'UFA', 'IR', 'M-NTC', '1996-07-22'),
    c('Anze Kopitar', 'C', 'LAK', 7_000_000, 1, 1, 2026, 'UFA', 'NHL', 'NMC', '1987-08-24'),
    c('Quinton Byfield', 'C', 'LAK', 6_250_000, 4, 4, 2029, 'UFA', 'NHL', null, '2002-08-19'),
    c('Artemi Panarin', 'LW', 'LAK', 5_821_429, 3, 3, 2028, 'UFA', 'NHL', null, '1991-10-30'),
    c('Adrian Kempe', 'RW', 'LAK', 5_500_000, 9, 9, 2034, 'UFA', 'NHL', null, '1996-09-13'),
    c('Andrei Kuzmenko', 'LW', 'LAK', 4_300_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-02-04'),
    c('Trevor Moore', 'RW', 'LAK', 4_200_000, 3, 3, 2028, 'UFA', 'NHL', null, '1995-03-31'),
    c('Alex Laferriere', 'RW', 'LAK', 4_100_000, 3, 3, 2028, 'RFA', 'NHL', null, '2001-10-28'),
    c('Warren Foegele', 'LW', 'LAK', 3_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1996-04-01'),
    c('Joel Armia', 'RW', 'LAK', 2_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1993-05-31'),
    c('Corey Perry', 'RW', 'LAK', 2_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1985-05-16'),
    c('Samuel Helenius', 'C', 'LAK', 805_833, 3, 3, 2028, 'RFA', 'NHL', null, '2002-11-26'),
    c('Alex Turcotte', 'C', 'LAK', 775_000, 2, 2, 2027, 'RFA', 'IR', null, '2001-02-26'),
    c('Jeff Malott', 'LW', 'LAK', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-08-07'),
    c('Taylor Ward', 'RW', 'LAK', 775_000, 3, 3, 2028, 'UFA', 'NHL', null, '1998-03-31'),
    // Defense
    c('Drew Doughty', 'D', 'LAK', 11_000_000, 2, 2, 2027, 'UFA', 'NHL', 'NMC', '1989-12-08'),
    c('Cody Ceci', 'D', 'LAK', 4_500_000, 4, 4, 2029, 'UFA', 'NHL', null, '1993-12-21'),
    c('Mikey Anderson', 'D', 'LAK', 4_125_000, 6, 6, 2031, 'UFA', 'IR', null, '1999-05-25'),
    c('Brian Dumoulin', 'D', 'LAK', 4_000_000, 3, 3, 2028, 'UFA', 'NHL', null, '1991-09-06'),
    c('Joel Edmundson', 'D', 'LAK', 3_850_000, 3, 3, 2028, 'UFA', 'NHL', null, '1993-06-28'),
    c('Brandt Clarke', 'D', 'LAK', 863_333, 1, 1, 2026, 'RFA', 'NHL', null, '2003-02-09'),
    c('Jacob Moverare', 'D', 'LAK', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-08-31'),
    // Goalies
    c('Darcy Kuemper', 'G', 'LAK', 5_250_000, 2, 2, 2027, 'UFA', 'NHL', null, '1990-05-05'),
    c('Anton Forsberg', 'G', 'LAK', 2_250_000, 2, 2, 2027, 'UFA', 'NHL', null, '1992-11-27'),
    c('Erik Portillo', 'G', 'LAK', 783_333, 2, 2, 2027, 'RFA', 'NHL', null),
    // Non-Roster Forwards (AHL)
    c('Vojtech Cihar', 'LW', 'LAK', 975_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jimmy Lombardi', 'C', 'LAK', 923_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jared Wright', 'RW', 'LAK', 867_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Kenny Connors', 'C', 'LAK', 867_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Aatu Jamsen', 'RW', 'LAK', 852_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Kaleb Lawrence', 'C', 'LAK', 852_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Francesco Pinelli', 'C', 'LAK', 845_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Koehn Ziemmer', 'RW', 'LAK', 816_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Glenn Gawdin', 'C', 'LAK', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Logan Brown', 'C', 'LAK', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Martin Chromiak', 'RW', 'LAK', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Nikita Alexandrov', 'C', 'LAK', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Cole Guttman', 'C', 'LAK', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Andre Lee', 'LW', 'LAK', 775_000, 2, 2, 2027, 'RFA', 'AHL', null, '2000-07-26'),
    // Non-Roster Defense (AHL)
    c('Kyle Burroughs', 'D', 'LAK', 1_100_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Kirill Kirsanov', 'D', 'LAK', 925_000, 2, 2, 2027, 'RFA', 'NHL', null),
    c('Jared Woolley', 'D', 'LAK', 875_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Otto Salin', 'D', 'LAK', 875_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jakub Dvorak', 'D', 'LAK', 840_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Angus Booth', 'D', 'LAK', 826_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Samuel Bolduc', 'D', 'LAK', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Joe Hicketts', 'D', 'LAK', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    // Non-Roster Goalies (AHL)
    c('Carter George', 'G', 'LAK', 845_833, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Pheonix Copley', 'G', 'LAK', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
  ],

  // ============================================================
  // SEA - Seattle Kraken
  // ============================================================
  'SEA': [
    // Forwards
    c('Matty Beniers', 'C', 'SEA', 7_142_857, 6, 6, 2031, 'UFA', 'NHL', null, '2002-11-05'),
    c('Chandler Stephenson', 'C', 'SEA', 6_250_000, 6, 6, 2031, 'UFA', 'NHL', null, '1994-04-22'),
    c('Jaden Schwartz', 'LW', 'SEA', 5_500_000, 1, 1, 2026, 'UFA', 'NHL', null, '1992-06-25'),
    c('Jared McCann', 'LW', 'SEA', 5_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1996-05-31'),
    c('Jordan Eberle', 'RW', 'SEA', 4_750_000, 1, 1, 2026, 'UFA', 'NHL', null, '1990-05-15'),
    c('Kaapo Kakko', 'RW', 'SEA', 4_525_000, 3, 3, 2028, 'UFA', 'NHL', null, '2001-02-13'),
    c('Eeli Tolvanen', 'RW', 'SEA', 3_475_000, 1, 1, 2026, 'UFA', 'NHL', null, '1999-04-22'),
    c('Frederick Gaudreau', 'C', 'SEA', 2_100_000, 3, 3, 2028, 'UFA', 'NHL', null, '1993-05-01'),
    c('Tye Kartye', 'LW', 'SEA', 1_250_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-04-30'),
    c('Berkly Catton', 'LW', 'SEA', 942_500, 3, 3, 2028, 'RFA', 'IR', null, '2006-01-14'),
    c('Shane Wright', 'C', 'SEA', 886_667, 2, 2, 2027, 'RFA', 'NHL', null, '2004-01-05'),
    c('Ryan Winterton', 'RW', 'SEA', 828_333, 1, 1, 2026, 'RFA', 'NHL', null, '2003-09-04'),
    c('Jacob Melanson', 'RW', 'SEA', 826_111, 1, 1, 2026, 'RFA', 'NHL', null, '2003-04-22'),
    c('Max McCormick', 'LW', 'SEA', 775_000, 1, 1, 2026, 'UFA', 'NHL', null),
    c('Ben Meyers', 'C', 'SEA', 775_000, 1, 1, 2026, 'UFA', 'IR', null, '1998-11-15'),
    // Defense
    c('Vince Dunn', 'D', 'SEA', 7_350_000, 2, 2, 2027, 'UFA', 'NHL', null, '1996-10-29'),
    c('Brandon Montour', 'D', 'SEA', 7_142_857, 6, 6, 2031, 'UFA', 'NHL', 'M-NTC', '1994-04-11'),
    c('Adam Larsson', 'D', 'SEA', 5_250_000, 4, 4, 2029, 'UFA', 'NHL', 'M-NTC', '1992-11-12'),
    c('Jamie Oleksiak', 'D', 'SEA', 4_600_000, 1, 1, 2026, 'UFA', 'NHL', null, '1992-12-21'),
    c('Ryan Lindgren', 'D', 'SEA', 4_500_000, 4, 4, 2029, 'UFA', 'NHL', null, '1998-02-11'),
    c('Ryker Evans', 'D', 'SEA', 2_050_000, 2, 2, 2027, 'RFA', 'NHL', null, '2001-12-13'),
    c('Josh Mahura', 'D', 'SEA', 907_500, 2, 2, 2027, 'UFA', 'NHL', null),
    c('Cale Fleury', 'D', 'SEA', 890_000, 2, 2, 2027, 'UFA', 'NHL', null, '1998-11-19'),
    // Goalies
    c('Philipp Grubauer', 'G', 'SEA', 5_900_000, 2, 2, 2027, 'UFA', 'NHL', null, '1991-11-25'),
    c('Joey Daccord', 'G', 'SEA', 5_000_000, 5, 5, 2030, 'UFA', 'NHL', null, '1996-08-19'),
    c('Matt Murray', 'G', 'SEA', 1_000_000, 1, 1, 2026, 'UFA', 'IR', null, '1994-05-25'),
    // Non-Roster Forwards (AHL)
    c('Jake O\'Brien', 'C', 'SEA', 975_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Nathan Villeneuve', 'C', 'SEA', 940_833, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Julius Miettinen', 'C', 'SEA', 940_833, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Carson Rehkopf', 'LW', 'SEA', 891_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jagger Firkus', 'RW', 'SEA', 891_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('David Goyette', 'C', 'SEA', 891_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Jani Nyman', 'RW', 'SEA', 891_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Oscar Fisker Molgaard', 'C', 'SEA', 891_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Eduard Sale', 'LW', 'SEA', 886_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Logan Morrison', 'C', 'SEA', 870_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Andrei Loshko', 'C', 'SEA', 870_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Lleyton Roed', 'LW', 'SEA', 870_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Jon-Randall Avon', 'C', 'SEA', 800_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Mitchell Stephens', 'C', 'SEA', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('John Hayden', 'C', 'SEA', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    // Non-Roster Defense (AHL)
    c('Tyson Jugnauth', 'D', 'SEA', 950_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Lukas Dragicevic', 'D', 'SEA', 891_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Ville Ottavainen', 'D', 'SEA', 867_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Kaden Hammell', 'D', 'SEA', 865_833, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Ty Nelson', 'D', 'SEA', 836_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Caden Price', 'D', 'SEA', 835_833, 3, 3, 2028, 'RFA', 'AHL', null),
    // Non-Roster Goalies (AHL)
    c('Niklas Kokko', 'G', 'SEA', 891_667, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Victor Ostman', 'G', 'SEA', 870_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Kim Saarinen', 'G', 'SEA', 840_000, 3, 3, 2028, 'RFA', 'AHL', null),
    // Dead Cap / Buyout
    // Joe Veleno: $795,833 buyout cap hit through 2027
  ],

  // ============================================================
  // SJS - San Jose Sharks
  // ============================================================
  'SJS': [
    // Forwards
    c('Logan Couture', 'C', 'SJS', 8_000_000, 2, 2, 2027, 'UFA', 'IR', 'NMC'),
    c('Tyler Toffoli', 'RW', 'SJS', 6_000_000, 3, 3, 2028, 'UFA', 'NHL', null, '1992-04-24'),
    c('Alexander Wennberg', 'C', 'SJS', 5_000_000, 4, 4, 2029, 'UFA', 'NHL', null, '1994-09-22'),
    c('Barclay Goodrow', 'LW', 'SJS', 3_641_667, 2, 2, 2027, 'UFA', 'NHL', null, '1993-02-26'),
    c('Adam Gaudette', 'RW', 'SJS', 2_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1996-10-03'),
    c('Kiefer Sherwood', 'RW', 'SJS', 1_500_000, 1, 1, 2026, 'UFA', 'NHL', null, '1995-03-31'),
    c('Ryan Reaves', 'RW', 'SJS', 1_350_000, 1, 1, 2026, 'UFA', 'IR', null, '1987-01-20'),
    c('Ty Dellandrea', 'C', 'SJS', 1_300_000, 1, 1, 2026, 'RFA', 'IR', null, '2000-07-21'),
    c('Philipp Kurashev', 'LW', 'SJS', 1_200_000, 1, 1, 2026, 'RFA', 'NHL', null, '1999-10-12'),
    c('Macklin Celebrini', 'C', 'SJS', 975_000, 2, 2, 2027, 'RFA', 'NHL', null),
    c('Michael Misa', 'C', 'SJS', 975_000, 3, 3, 2028, 'RFA', 'NHL', null, '2007-02-16'),
    c('Will Smith', 'RW', 'SJS', 950_000, 2, 2, 2027, 'RFA', 'NHL', null, '2005-03-17'),
    c('Collin Graf', 'RW', 'SJS', 941_667, 1, 1, 2026, 'RFA', 'NHL', null, '2002-09-21'),
    c('Filip Bystedt', 'C', 'SJS', 918_333, 2, 2, 2027, 'RFA', 'NHL', null, '2004-02-04'),
    c('William Eklund', 'LW', 'SJS', 863_333, 4, 4, 2029, 'RFA', 'NHL', null, '2002-10-12'),
    c('Zack Ostapchuk', 'C', 'SJS', 825_000, 1, 1, 2026, 'RFA', 'NHL', null, '2003-05-29'),
    c('Pavol Regenda', 'LW', 'SJS', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1999-12-07'),
    // Defense
    c('Dmitry Orlov', 'D', 'SJS', 6_500_000, 2, 2, 2027, 'UFA', 'NHL', null, '1991-07-23'),
    c('John Klingberg', 'D', 'SJS', 4_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1992-08-14'),
    c('Mario Ferraro', 'D', 'SJS', 3_250_000, 1, 1, 2026, 'UFA', 'NHL', null, '1998-09-17'),
    c('Timothy Liljegren', 'D', 'SJS', 3_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1999-04-30'),
    c('Vincent Desharnais', 'D', 'SJS', 2_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-05-29'),
    c('Shakir Mukhamadullin', 'D', 'SJS', 1_000_000, 1, 1, 2026, 'RFA', 'NHL', null, '2002-01-10'),
    c('Sam Dickinson', 'D', 'SJS', 942_500, 3, 3, 2028, 'RFA', 'NHL', null, '2006-06-07'),
    // Goalies
    c('Alex Nedeljkovic', 'G', 'SJS', 2_500_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-01-07'),
    c('Yaroslav Askarov', 'G', 'SJS', 2_000_000, 2, 2, 2027, 'RFA', 'NHL', null, '2002-06-16'),
    // Non-Roster Forwards (AHL)
    c('Cameron Lund', 'C', 'SJS', 941_667, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Igor Chernyshov', 'RW', 'SJS', 934_167, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Quentin Musty', 'LW', 'SJS', 886_667, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Kasper Halttunen', 'RW', 'SJS', 876_667, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Ethan Cardwell', 'RW', 'SJS', 867_500, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Egor Afanasyev', 'LW', 'SJS', 800_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Jimmy Huntington', 'C', 'SJS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Samuel Laberge', 'LW', 'SJS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Shane Bowers', 'C', 'SJS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Colin White', 'C', 'SJS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Patrick Giles', 'C', 'SJS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Non-Roster Defense (AHL)
    c('Nick Leddy', 'D', 'SJS', 4_000_000, 1, 1, 2026, 'UFA', 'AHL', null, '1991-03-20'), // Buried
    c('Noah Beck', 'D', 'SJS', 975_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Leo Sahlin Wallenius', 'D', 'SJS', 940_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Mattias Havelid', 'D', 'SJS', 905_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Luca Cagnoni', 'D', 'SJS', 895_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Nolan Allan', 'D', 'SJS', 825_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Lucas Carlsson', 'D', 'SJS', 800_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Jack Thompson', 'D', 'SJS', 800_000, 1, 1, 2026, 'RFA', 'AHL', null),
    // Non-Roster Goalies (AHL)
    c('Laurent Brossoit', 'G', 'SJS', 2_150_000, 1, 1, 2026, 'UFA', 'AHL', null), // Buried
    c('Gabriel Carriere', 'G', 'SJS', 795_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Jakub Skarek', 'G', 'SJS', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Dead Cap / Retained
    // Erik Karlsson: $1,500,000 retained, 2 years through 2027
    // Tomas Hertl: $1,387,500 retained, 5 years through 2030
    // Marc-Edouard Vlasic: buyout
    // Martin Jones: buyout
  ],

  // ============================================================
  // VAN - Vancouver Canucks
  // ============================================================
  'VAN': [
    // Forwards
    c('Elias Pettersson', 'C', 'VAN', 11_600_000, 8, 7, 2032, 'UFA', 'NHL', 'NMC', '1998-11-12'),
    c('Brock Boeser', 'RW', 'VAN', 7_250_000, 7, 7, 2032, 'UFA', 'IR', null, '1997-02-25'),
    c('Jake DeBrusk', 'LW', 'VAN', 5_500_000, 6, 6, 2031, 'UFA', 'NHL', null, '1996-10-17'),
    c('Evander Kane', 'LW', 'VAN', 5_125_000, 1, 1, 2026, 'UFA', 'NHL', null, '1991-08-02'),
    c('Marco Rossi', 'C', 'VAN', 5_000_000, 3, 3, 2028, 'RFA', 'IR', null, '2001-09-23'),
    c('Conor Garland', 'RW', 'VAN', 4_950_000, 7, 7, 2032, 'UFA', 'NHL', null, '1996-03-11'),
    c('Filip Chytil', 'C', 'VAN', 4_437_500, 2, 2, 2027, 'UFA', 'NHL', null, '1999-09-05'),
    c('Nils Hoglander', 'LW', 'VAN', 3_000_000, 3, 3, 2028, 'UFA', 'NHL', null, '2000-12-20'),
    c('Drew O\'Connor', 'LW', 'VAN', 2_500_000, 2, 2, 2027, 'UFA', 'NHL', null),
    c('Teddy Blueger', 'C', 'VAN', 1_800_000, 1, 1, 2026, 'UFA', 'NHL', null, '1994-08-15'),
    c('David Kampf', 'C', 'VAN', 1_100_000, 1, 1, 2026, 'UFA', 'NHL', null, '1995-01-12'),
    c('Liam Ohgren', 'LW', 'VAN', 886_667, 2, 2, 2027, 'RFA', 'NHL', null, '2004-01-28'),
    c('Aatu Raty', 'C', 'VAN', 775_000, 2, 2, 2027, 'RFA', 'NHL', null),
    c('Linus Karlsson', 'RW', 'VAN', 775_000, 3, 3, 2028, 'UFA', 'NHL', null, '1999-11-16'),
    c('Max Sasson', 'C', 'VAN', 775_000, 3, 3, 2028, 'UFA', 'NHL', null, '2000-09-05'),
    // Defense
    c('Filip Hronek', 'D', 'VAN', 7_250_000, 7, 7, 2032, 'UFA', 'NHL', null, '1997-11-02'),
    c('Marcus Pettersson', 'D', 'VAN', 5_500_000, 6, 6, 2031, 'UFA', 'NHL', null, '1996-05-08'),
    c('Tyler Myers', 'D', 'VAN', 3_000_000, 2, 2, 2027, 'UFA', 'NHL', null, '1990-02-01'),
    c('Derek Forbort', 'D', 'VAN', 2_000_000, 1, 1, 2026, 'UFA', 'LTIR', null, '1992-03-04'),
    c('Zeev Buium', 'D', 'VAN', 966_500, 2, 2, 2027, 'RFA', 'IR', null, '2005-12-07'),
    c('Tom Willander', 'D', 'VAN', 950_000, 3, 3, 2028, 'RFA', 'NHL', null, '2005-02-09'),
    c('Elias Pettersson', 'D', 'VAN', 838_333, 2, 2, 2027, 'RFA', 'NHL', null, '1998-11-12'), // Defenseman Elias Pettersson (different player)
    c('Pierre-Olivier Joseph', 'D', 'VAN', 775_000, 1, 1, 2026, 'RFA', 'NHL', null, '1999-07-01'),
    c('Guillaume Brisebois', 'D', 'VAN', 775_000, 1, 1, 2026, 'UFA', 'IR', null),
    // Goalies
    c('Thatcher Demko', 'G', 'VAN', 5_000_000, 4, 4, 2029, 'UFA', 'IR', null, '1995-12-08'),
    c('Kevin Lankinen', 'G', 'VAN', 4_500_000, 5, 5, 2030, 'UFA', 'NHL', null, '1995-04-28'),
    c('Aku Koskenvuo', 'G', 'VAN', 850_000, 2, 2, 2027, 'RFA', 'NHL', null, '2003-02-26'),
    c('Jiri Patera', 'G', 'VAN', 775_000, 1, 1, 2026, 'UFA', 'NHL', null, '1999-02-24'),
    // Non-Roster Forwards (AHL)
    c('Braeden Cootes', 'C', 'VAN', 975_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Riley Patterson', 'C', 'VAN', 923_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jonathan Lekkerimaki', 'RW', 'VAN', 918_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Gabe Chiarot', 'RW', 'VAN', 916_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Anri Ravinskis', 'RW', 'VAN', 872_500, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Ty Mueller', 'C', 'VAN', 870_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Chase Stillman', 'RW', 'VAN', 863_333, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Josh Bloom', 'LW', 'VAN', 836_667, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Danila Klimovich', 'RW', 'VAN', 833_333, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Vilmer Alriksson', 'LW', 'VAN', 831_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Nils Aman', 'C', 'VAN', 825_000, 1, 1, 2026, 'RFA', 'AHL', null, '2000-02-07'),
    c('Joseph LaBate', 'RW', 'VAN', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Mackenzie MacEachern', 'LW', 'VAN', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Arshdeep Bains', 'LW', 'VAN', 775_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Lukas Reichel', 'C', 'VAN', 50_000, 1, 1, 2026, 'RFA', 'AHL', null), // Buried penalty
    // Non-Roster Defense (AHL)
    c('Victor Mancini', 'D', 'VAN', 870_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Kirill Kudryavtsev', 'D', 'VAN', 825_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Sawyer Mynio', 'D', 'VAN', 806_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jimmy Schuldt', 'D', 'VAN', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Jett Woo', 'D', 'VAN', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Cole Clayton', 'D', 'VAN', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    // Non-Roster Goalies (AHL)
    c('Alexei Medvedev', 'G', 'VAN', 923_333, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Ty Young', 'G', 'VAN', 825_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Nikita Tolopilo', 'G', 'VAN', 775_000, 2, 2, 2027, 'UFA', 'AHL', null),
    // Dead Cap / Retained / Buyout
    // Ilya Mikheyev: $712,500 retained (traded)
    // Oliver Ekman-Larsson: $4,766,667 buyout through 2031
  ],

  // ============================================================
  // VGK - Vegas Golden Knights
  // ============================================================
  'VGK': [
    // Forwards
    c('Mitch Marner', 'RW', 'VGK', 12_000_000, 8, 8, 2033, 'UFA', 'NHL', null, '1997-05-05'),
    c('Jack Eichel', 'C', 'VGK', 10_000_000, 9, 9, 2034, 'UFA', 'NHL', 'M-NTC', '1996-10-28'),
    c('Mark Stone', 'RW', 'VGK', 9_500_000, 2, 2, 2027, 'UFA', 'NHL', 'NMC', '1992-05-13'),
    c('Tomas Hertl', 'C', 'VGK', 6_750_000, 5, 5, 2030, 'UFA', 'NHL', null, '1993-11-12'),
    c('Ivan Barbashev', 'LW', 'VGK', 5_000_000, 3, 3, 2028, 'UFA', 'NHL', null, '1995-12-14'),
    c('Brett Howden', 'C', 'VGK', 2_500_000, 5, 5, 2030, 'UFA', 'IR', null, '1998-03-29'),
    c('Keegan Kolesar', 'RW', 'VGK', 2_500_000, 3, 3, 2028, 'UFA', 'NHL', null, '1997-04-08'),
    c('Brandon Saad', 'LW', 'VGK', 2_000_000, 1, 1, 2026, 'UFA', 'IR', null, '1992-10-27'),
    c('Reilly Smith', 'RW', 'VGK', 2_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1991-04-01'),
    c('Pavel Dorofeyev', 'LW', 'VGK', 1_835_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-10-26'),
    c('Colton Sissons', 'C', 'VGK', 1_428_572, 1, 1, 2026, 'UFA', 'NHL', null, '1993-11-05'),
    c('Alexander Holtz', 'RW', 'VGK', 837_500, 2, 2, 2027, 'RFA', 'NHL', null, '2002-01-23'),
    c('Braeden Bowman', 'RW', 'VGK', 837_500, 2, 2, 2027, 'RFA', 'NHL', null, '2003-06-26'),
    c('Cole Reinhardt', 'LW', 'VGK', 812_500, 2, 2, 2027, 'UFA', 'NHL', null, '2000-02-01'),
    c('Jonas Rondbjerg', 'LW', 'VGK', 775_000, 1, 1, 2026, 'UFA', 'IR', null, '1999-03-31'),
    // Defense
    c('Alex Pietrangelo', 'D', 'VGK', 8_800_000, 2, 2, 2027, 'UFA', 'IR', 'NMC'), // Season-ending IR
    c('Shea Theodore', 'D', 'VGK', 7_425_000, 7, 7, 2032, 'UFA', 'NHL', 'M-NTC', '1995-08-03'),
    c('Noah Hanifin', 'D', 'VGK', 7_350_000, 7, 7, 2032, 'UFA', 'NHL', null, '1997-01-25'),
    c('Brayden McNabb', 'D', 'VGK', 3_650_000, 3, 3, 2028, 'UFA', 'IR', null, '1991-01-21'),
    // Rasmus Andersson: 50% retained by CGY, VGK carries $2,275,000
    c('Rasmus Andersson', 'D', 'VGK', 2_275_000, 1, 1, 2026, 'UFA', 'NHL', null, '1996-10-27'), // 50% retained by CGY
    c('Jeremy Lauzon', 'D', 'VGK', 2_000_000, 1, 1, 2026, 'UFA', 'NHL', null, '1997-04-28'),
    c('Ben Hutton', 'D', 'VGK', 975_000, 1, 1, 2026, 'UFA', 'NHL', null, '1993-04-20'),
    c('Kaedan Korczak', 'D', 'VGK', 825_000, 5, 5, 2030, 'UFA', 'NHL', null, '2001-01-29'),
    // Goalies
    c('Adin Hill', 'G', 'VGK', 6_250_000, 6, 6, 2031, 'UFA', 'NHL', null, '1996-05-11'),
    c('Carter Hart', 'G', 'VGK', 2_000_000, 2, 2, 2027, 'UFA', 'IR', null, '1998-08-13'),
    c('Akira Schmid', 'G', 'VGK', 875_000, 1, 1, 2026, 'RFA', 'NHL', null, '2000-05-12'),
    // LTIR
    c('William Karlsson', 'C', 'VGK', 3_817_293, 2, 2, 2027, 'UFA', 'LTIR', null, '1993-01-08'),
    // Non-Roster Forwards (AHL)
    c('Trevor Connelly', 'LW', 'VGK', 975_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jackson Hallum', 'LW', 'VGK', 925_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Tuomas Uronen', 'RW', 'VGK', 852_500, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Jakub Demek', 'C', 'VGK', 851_683, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Trent Swick', 'LW', 'VGK', 850_000, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Kai Uchacz', 'C', 'VGK', 845_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Joe Fleming', 'RW', 'VGK', 836_667, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Jordan Gustafson', 'C', 'VGK', 830_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Jakub Brabenec', 'C', 'VGK', 828_333, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Ben Hemmerling', 'RW', 'VGK', 821_111, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Matyas Sapovaliv', 'C', 'VGK', 803_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Mathieu Cataford', 'C', 'VGK', 801_667, 3, 3, 2028, 'RFA', 'AHL', null),
    c('Raphael Lavoie', 'C', 'VGK', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    c('Tanner Laczynski', 'C', 'VGK', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Non-Roster Defense (AHL)
    c('Jeremy Davies', 'D', 'VGK', 1_150_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Christoffer Sedoff', 'D', 'VGK', 870_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Viliam Kmec', 'D', 'VGK', 833_333, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Jaycob Megna', 'D', 'VGK', 800_000, 2, 2, 2027, 'UFA', 'AHL', null),
    c('Lukas Cormier', 'D', 'VGK', 775_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Dylan Coghlan', 'D', 'VGK', 775_000, 1, 1, 2026, 'UFA', 'AHL', null),
    // Non-Roster Goalies (AHL)
    c('Cameron Whitehead', 'G', 'VGK', 875_000, 2, 2, 2027, 'RFA', 'AHL', null),
    c('Jesper Vikman', 'G', 'VGK', 858_000, 1, 1, 2026, 'RFA', 'AHL', null),
    c('Carl Lindbom', 'G', 'VGK', 840_000, 1, 1, 2026, 'RFA', 'AHL', null),
  ],

};
