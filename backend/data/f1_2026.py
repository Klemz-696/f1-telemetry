"""
f1_2026.py
Dictionnaire de données statique saison F1 2026.
Inclut : pilotes, équipes, calendrier complet (GP annulés inclus), classements mis à jour.
Classements : état au 26 avril 2026 (après GP du Japon, manche 3/22).
"""

TEAMS_2026 = {
    "Mercedes":     {"color": "#27F4D2", "color_light": "#27F4D2", "short": "MER"},
    "Red Bull":     {"color": "#3671C6", "color_light": "#3671C6", "short": "RBR"},
    "Ferrari":      {"color": "#E8002D", "color_light": "#E8002D", "short": "FER"},
    "McLaren":      {"color": "#FF8000", "color_light": "#FF8000", "short": "MCL"},
    "Aston Martin": {"color": "#229971", "color_light": "#229971", "short": "AMR"},
    "Alpine":       {"color": "#00A1E8", "color_light": "#00A1E8", "short": "ALP"},
    "Haas":         {"color": "#E6002D", "color_light": "#DEE1E2", "short": "HAA"},
    "Williams":     {"color": "#1868DB", "color_light": "#1868DB", "short": "WIL"},
    "Racing Bulls": {"color": "#6692FF", "color_light": "#6692FF", "short": "RBU"},
    "Audi":         {"color": "#FF2D00", "color_light": "#FF2D00", "short": "AUD"},
    "Cadillac":     {"color": "#AAAAAD", "color_light": "#AAAAAD", "short": "CAD"},
}

# 22 pilotes confirmés pour 2026 (11 écuries × 2)
DRIVERS_2026 = {
    1:  {"acronym": "NOR", "name": "Lando Norris",        "team": "McLaren",      "number": 1,  "flag": "🇬🇧"},
    3:  {"acronym": "VER", "name": "Max Verstappen",      "team": "Red Bull",     "number": 3,  "flag": "🇳🇱"},
    5:  {"acronym": "BOR", "name": "Gabriel Bortoleto",   "team": "Audi",         "number": 5,  "flag": "🇧🇷"},
    6:  {"acronym": "HAD", "name": "Isack Hadjar",        "team": "Red Bull",     "number": 6,  "flag": "🇫🇷"},
    10: {"acronym": "GAS", "name": "Pierre Gasly",        "team": "Alpine",       "number": 10, "flag": "🇫🇷"},
    11: {"acronym": "PER", "name": "Sergio Pérez",        "team": "Cadillac",     "number": 11, "flag": "🇲🇽"},
    12: {"acronym": "ANT", "name": "Kimi Antonelli",      "team": "Mercedes",     "number": 12, "flag": "🇮🇹"},
    14: {"acronym": "ALO", "name": "Fernando Alonso",     "team": "Aston Martin", "number": 14, "flag": "🇪🇸"},
    16: {"acronym": "LEC", "name": "Charles Leclerc",     "team": "Ferrari",      "number": 16, "flag": "🇲🇨"},
    18: {"acronym": "STR", "name": "Lance Stroll",        "team": "Aston Martin", "number": 18, "flag": "🇨🇦"},
    23: {"acronym": "ALB", "name": "Alexander Albon",     "team": "Williams",     "number": 23, "flag": "🇹🇭"},
    27: {"acronym": "HUL", "name": "Nico Hülkenberg",    "team": "Audi",         "number": 27, "flag": "🇩🇪"},
    30: {"acronym": "LAW", "name": "Liam Lawson",         "team": "Racing Bulls", "number": 30, "flag": "🇳🇿"},
    31: {"acronym": "OCO", "name": "Esteban Ocon",        "team": "Haas",         "number": 31, "flag": "🇫🇷"},
    41: {"acronym": "LIN", "name": "Arvid Lindblad",      "team": "Racing Bulls", "number": 41, "flag": "🇸🇪"},
    43: {"acronym": "COL", "name": "Franco Colapinto",    "team": "Alpine",       "number": 43, "flag": "🇦🇷"},
    44: {"acronym": "HAM", "name": "Lewis Hamilton",      "team": "Ferrari",      "number": 44, "flag": "🇬🇧"},
    55: {"acronym": "SAI", "name": "Carlos Sainz Jr.",    "team": "Williams",     "number": 55, "flag": "🇪🇸"},
    63: {"acronym": "RUS", "name": "George Russell",      "team": "Mercedes",     "number": 63, "flag": "🇬🇧"},
    77: {"acronym": "BOT", "name": "Valtteri Bottas",     "team": "Cadillac",     "number": 77, "flag": "🇫🇮"},
    81: {"acronym": "PIA", "name": "Oscar Piastri",       "team": "McLaren",      "number": 81, "flag": "🇦🇺"},
    87: {"acronym": "BEA", "name": "Oliver Bearman",      "team": "Haas",         "number": 87, "flag": "🇬🇧"},
}

# Classement Pilotes — état après 3 manches (Australie, Chine Sprint+Course, Japon)
# Source : standings réels au 26 avril 2026
DRIVERS_STANDINGS_2026 = [
    {"position": 1,  "acronym": "ANT", "driver_number": 12, "name": "Kimi Antonelli",      "team": "Mercedes",     "points": 72,  "wins": 2, "flag": "🇮🇹"},
    {"position": 2,  "acronym": "RUS", "driver_number": 63, "name": "George Russell",      "team": "Mercedes",     "points": 63,  "wins": 1, "flag": "🇬🇧"},
    {"position": 3,  "acronym": "LEC", "driver_number": 16, "name": "Charles Leclerc",     "team": "Ferrari",      "points": 49,  "wins": 0, "flag": "🇲🇨"},
    {"position": 4,  "acronym": "HAM", "driver_number": 44, "name": "Lewis Hamilton",      "team": "Ferrari",      "points": 41,  "wins": 0, "flag": "🇬🇧"},
    {"position": 5,  "acronym": "NOR", "driver_number": 1,  "name": "Lando Norris",        "team": "McLaren",      "points": 25,  "wins": 0, "flag": "🇬🇧"},
    {"position": 6,  "acronym": "PIA", "driver_number": 81, "name": "Oscar Piastri",       "team": "McLaren",      "points": 21,  "wins": 0, "flag": "🇦🇺"},
    {"position": 7,  "acronym": "BEA", "driver_number": 87, "name": "Oliver Bearman",      "team": "Haas",         "points": 17,  "wins": 0, "flag": "🇬🇧"},
    {"position": 8,  "acronym": "GAS", "driver_number": 10, "name": "Pierre Gasly",        "team": "Alpine",       "points": 15,  "wins": 0, "flag": "🇫🇷"},
    {"position": 9,  "acronym": "VER", "driver_number": 3,  "name": "Max Verstappen",      "team": "Red Bull",     "points": 12,  "wins": 0, "flag": "🇳🇱"},
    {"position": 10, "acronym": "LAW", "driver_number": 30, "name": "Liam Lawson",         "team": "Racing Bulls", "points": 10,  "wins": 0, "flag": "🇳🇿"},
    {"position": 11, "acronym": "HAD", "driver_number": 6,  "name": "Isack Hadjar",        "team": "Red Bull",     "points": 8,   "wins": 0, "flag": "🇫🇷"},
    {"position": 12, "acronym": "BOR", "driver_number": 5,  "name": "Gabriel Bortoleto",   "team": "Audi",         "points": 2,   "wins": 0, "flag": "🇧🇷"},
    {"position": 13, "acronym": "SAI", "driver_number": 55, "name": "Carlos Sainz Jr.",    "team": "Williams",     "points": 2,   "wins": 0, "flag": "🇪🇸"},
    {"position": 14, "acronym": "LIN", "driver_number": 41, "name": "Arvid Lindblad",      "team": "Racing Bulls", "points": 2,   "wins": 0, "flag": "🇸🇪"},
    {"position": 15, "acronym": "COL", "driver_number": 43, "name": "Franco Colapinto",    "team": "Alpine",       "points": 1,   "wins": 0, "flag": "🇦🇷"},
    {"position": 16, "acronym": "OCO", "driver_number": 31, "name": "Esteban Ocon",        "team": "Haas",         "points": 0,   "wins": 0, "flag": "🇫🇷"},
    {"position": 17, "acronym": "ALB", "driver_number": 23, "name": "Alexander Albon",     "team": "Williams",     "points": 0,   "wins": 0, "flag": "🇹🇭"},
    {"position": 18, "acronym": "PER", "driver_number": 11, "name": "Sergio Pérez",        "team": "Cadillac",     "points": 0,   "wins": 0, "flag": "🇲🇽"},
    {"position": 19, "acronym": "BOT", "driver_number": 77, "name": "Valtteri Bottas",     "team": "Cadillac",     "points": 0,   "wins": 0, "flag": "🇫🇮"},
    {"position": 20, "acronym": "ALO", "driver_number": 14, "name": "Fernando Alonso",     "team": "Aston Martin", "points": 0,   "wins": 0, "flag": "🇪🇸"},
    {"position": 21, "acronym": "STR", "driver_number": 18, "name": "Lance Stroll",        "team": "Aston Martin", "points": 0,   "wins": 0, "flag": "🇨🇦"},
    {"position": 22, "acronym": "HUL", "driver_number": 27, "name": "Nico Hülkenberg",    "team": "Audi",         "points": 0,   "wins": 0, "flag": "🇩🇪"},
]

# Classement Constructeurs — état après 3 manches (26 avril 2026)
TEAMS_STANDINGS_2026 = [
    {"position": 1,  "name": "Mercedes",     "points": 135},
    {"position": 2,  "name": "Ferrari",      "points": 90},
    {"position": 3,  "name": "McLaren",      "points": 46},
    {"position": 4,  "name": "Haas",         "points": 17},
    {"position": 5,  "name": "Red Bull",     "points": 20},
    {"position": 6,  "name": "Alpine",       "points": 16},
    {"position": 7,  "name": "Racing Bulls", "points": 12},
    {"position": 8,  "name": "Audi",         "points": 2},
    {"position": 9,  "name": "Williams",     "points": 2},
    {"position": 10, "name": "Cadillac",     "points": 0},
    {"position": 11, "name": "Aston Martin", "points": 0},
]

# Calendrier complet 2026 — 22 manches (Bahreïn et Arabie Saoudite annulés)
CALENDAR_2026 = [
    {
        "round": 1,  "name": "Grand Prix d'Australie",       "location": "Melbourne",
        "country": "Australie",   "country_code": "AU",
        "circuit": "Albert Park Circuit",
        "date_start": "2026-03-06", "date_end": "2026-03-08",
        "sprint": False, "cancelled": False,
        "meeting_key": 1279,
        "circuit_id": "albert_park",
        "circuit_laps": 58,
        "circuit_length_km": 5.278,
        "circuit_first_gp": 1996,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-03-06T11:30:00+11:00"},
            {"name": "Essais Libres 2", "date": "2026-03-06T15:00:00+11:00"},
            {"name": "Essais Libres 3", "date": "2026-03-07T11:30:00+11:00"},
            {"name": "Qualifications",  "date": "2026-03-07T15:00:00+11:00"},
            {"name": "Course",          "date": "2026-03-08T15:00:00+11:00"},
        ]
    },
    {
        "round": 2,  "name": "Grand Prix de Chine",           "location": "Shanghai",
        "country": "Chine",       "country_code": "CN",
        "circuit": "Shanghai International Circuit",
        "date_start": "2026-03-13", "date_end": "2026-03-15",
        "sprint": True, "cancelled": False,
        "meeting_key": 1281,
        "circuit_id": "shanghai",
        "circuit_laps": 56,
        "circuit_length_km": 5.451,
        "circuit_first_gp": 2004,
        "sessions": [
            {"name": "Essais Libres 1",  "date": "2026-03-13T11:30:00+08:00"},
            {"name": "Sprint Qualifying","date": "2026-03-13T15:30:00+08:00"},
            {"name": "Sprint",           "date": "2026-03-14T11:00:00+08:00"},
            {"name": "Qualifications",   "date": "2026-03-14T15:00:00+08:00"},
            {"name": "Course",           "date": "2026-03-15T15:00:00+08:00"},
        ]
    },
    {
        "round": 3,  "name": "Grand Prix du Japon",           "location": "Suzuka",
        "country": "Japon",       "country_code": "JP",
        "circuit": "Suzuka International Racing Course",
        "date_start": "2026-03-27", "date_end": "2026-03-29",
        "sprint": False, "cancelled": False,
        "meeting_key": 1253,
        "circuit_id": "suzuka",
        "circuit_laps": 53,
        "circuit_length_km": 5.807,
        "circuit_first_gp": 1987,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-03-27T11:30:00+09:00"},
            {"name": "Essais Libres 2", "date": "2026-03-27T15:00:00+09:00"},
            {"name": "Essais Libres 3", "date": "2026-03-28T11:30:00+09:00"},
            {"name": "Qualifications",  "date": "2026-03-28T15:00:00+09:00"},
            {"name": "Course",          "date": "2026-03-29T14:00:00+09:00"},
        ]
    },
    {
        "round": 4,  "name": "Grand Prix de Bahreïn",         "location": "Sakhir",
        "country": "Bahreïn",     "country_code": "BH",
        "circuit": "Bahrain International Circuit",
        "date_start": "2026-04-11", "date_end": "2026-04-13",
        "sprint": False, "cancelled": True,
        "meeting_key": None,
        "circuit_id": "bahrain",
        "circuit_laps": 57,
        "circuit_length_km": 5.412,
        "circuit_first_gp": 2004,
        "cancel_reason": "GP annulé — retiré du calendrier 2026 (raisons sécuritaires)",
        "sessions": []
    },
    {
        "round": 5,  "name": "Grand Prix d'Arabie Saoudite",  "location": "Djeddah",
        "country": "Arabie Saoudite", "country_code": "SA",
        "circuit": "Jeddah Corniche Circuit",
        "date_start": "2026-04-17", "date_end": "2026-04-19",
        "sprint": False, "cancelled": True,
        "meeting_key": None,
        "circuit_id": "jeddah",
        "circuit_laps": 50,
        "circuit_length_km": 6.174,
        "circuit_first_gp": 2021,
        "cancel_reason": "GP annulé — retiré du calendrier 2026 (raisons sécuritaires)",
        "sessions": []
    },
    {
        "round": 6,  "name": "Grand Prix de Miami",           "location": "Miami",
        "country": "États-Unis",   "country_code": "US",
        "circuit": "Miami International Autodrome",
        "date_start": "2026-05-01", "date_end": "2026-05-03",
        "sprint": True, "cancelled": False,
        "meeting_key": 1285,
        "circuit_id": "miami",
        "circuit_laps": 57,
        "circuit_length_km": 5.412,
        "circuit_first_gp": 2022,
        "sessions": [
            {"name": "Essais Libres 1",  "date": "2026-05-01T20:30:00-04:00"},
            {"name": "Sprint Qualifying","date": "2026-05-02T00:30:00-04:00"},
            {"name": "Sprint",           "date": "2026-05-02T20:00:00-04:00"},
            {"name": "Qualifications",   "date": "2026-05-03T00:00:00-04:00"},
            {"name": "Course",           "date": "2026-05-03T20:00:00-04:00"},
        ]
    },
    {
        "round": 7,  "name": "Grand Prix du Canada",          "location": "Montréal",
        "country": "Canada",       "country_code": "CA",
        "circuit": "Circuit Gilles Villeneuve",
        "date_start": "2026-05-22", "date_end": "2026-05-24",
        "sprint": False, "cancelled": False,
        "meeting_key": 1287,
        "circuit_id": "villeneuve",
        "circuit_laps": 70,
        "circuit_length_km": 4.361,
        "circuit_first_gp": 1978,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-05-22T13:30:00-04:00"},
            {"name": "Essais Libres 2", "date": "2026-05-22T17:00:00-04:00"},
            {"name": "Essais Libres 3", "date": "2026-05-23T12:30:00-04:00"},
            {"name": "Qualifications",  "date": "2026-05-23T16:00:00-04:00"},
            {"name": "Course",          "date": "2026-05-24T14:00:00-04:00"},
        ]
    },
    {
        "round": 8,  "name": "Grand Prix de Monaco",          "location": "Monaco",
        "country": "Monaco",       "country_code": "MC",
        "circuit": "Circuit de Monaco",
        "date_start": "2026-06-05", "date_end": "2026-06-07",
        "sprint": False, "cancelled": False,
        "meeting_key": 1289,
        "circuit_id": "monaco",
        "circuit_laps": 78,
        "circuit_length_km": 3.337,
        "circuit_first_gp": 1950,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-06-05T13:30:00+02:00"},
            {"name": "Essais Libres 2", "date": "2026-06-05T17:00:00+02:00"},
            {"name": "Essais Libres 3", "date": "2026-06-06T12:30:00+02:00"},
            {"name": "Qualifications",  "date": "2026-06-06T16:00:00+02:00"},
            {"name": "Course",          "date": "2026-06-07T15:00:00+02:00"},
        ]
    },
    {
        "round": 9,  "name": "Grand Prix d'Espagne",          "location": "Barcelone",
        "country": "Espagne",      "country_code": "ES",
        "circuit": "Circuit de Barcelona-Catalunya",
        "date_start": "2026-06-12", "date_end": "2026-06-14",
        "sprint": False, "cancelled": False,
        "meeting_key": 1291,
        "circuit_id": "catalunya",
        "circuit_laps": 66,
        "circuit_length_km": 4.657,
        "circuit_first_gp": 1991,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-06-12T13:30:00+02:00"},
            {"name": "Essais Libres 2", "date": "2026-06-12T17:00:00+02:00"},
            {"name": "Essais Libres 3", "date": "2026-06-13T12:30:00+02:00"},
            {"name": "Qualifications",  "date": "2026-06-13T16:00:00+02:00"},
            {"name": "Course",          "date": "2026-06-14T15:00:00+02:00"},
        ]
    },
    {
        "round": 10, "name": "Grand Prix d'Autriche",         "location": "Spielberg",
        "country": "Autriche",     "country_code": "AT",
        "circuit": "Red Bull Ring",
        "date_start": "2026-06-26", "date_end": "2026-06-28",
        "sprint": False, "cancelled": False,
        "meeting_key": 1293,
        "circuit_id": "red_bull_ring",
        "circuit_laps": 71,
        "circuit_length_km": 4.318,
        "circuit_first_gp": 1970,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-06-26T13:30:00+02:00"},
            {"name": "Essais Libres 2", "date": "2026-06-26T17:00:00+02:00"},
            {"name": "Essais Libres 3", "date": "2026-06-27T12:30:00+02:00"},
            {"name": "Qualifications",  "date": "2026-06-27T16:00:00+02:00"},
            {"name": "Course",          "date": "2026-06-28T15:00:00+02:00"},
        ]
    },
    {
        "round": 11, "name": "Grand Prix de Grande-Bretagne", "location": "Silverstone",
        "country": "Royaume-Uni",  "country_code": "GB",
        "circuit": "Silverstone Circuit",
        "date_start": "2026-07-03", "date_end": "2026-07-05",
        "sprint": True, "cancelled": False,
        "meeting_key": 1295,
        "circuit_id": "silverstone",
        "circuit_laps": 52,
        "circuit_length_km": 5.891,
        "circuit_first_gp": 1950,
        "sessions": [
            {"name": "Essais Libres 1",  "date": "2026-07-03T12:30:00+01:00"},
            {"name": "Sprint Qualifying","date": "2026-07-03T16:30:00+01:00"},
            {"name": "Sprint",           "date": "2026-07-04T12:00:00+01:00"},
            {"name": "Qualifications",   "date": "2026-07-04T16:00:00+01:00"},
            {"name": "Course",           "date": "2026-07-05T15:00:00+01:00"},
        ]
    },
    {
        "round": 12, "name": "Grand Prix de Belgique",        "location": "Spa-Francorchamps",
        "country": "Belgique",     "country_code": "BE",
        "circuit": "Circuit de Spa-Francorchamps",
        "date_start": "2026-07-17", "date_end": "2026-07-19",
        "sprint": False, "cancelled": False,
        "meeting_key": 1297,
        "circuit_id": "spa",
        "circuit_laps": 44,
        "circuit_length_km": 7.004,
        "circuit_first_gp": 1950,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-07-17T13:30:00+02:00"},
            {"name": "Essais Libres 2", "date": "2026-07-17T17:00:00+02:00"},
            {"name": "Essais Libres 3", "date": "2026-07-18T12:30:00+02:00"},
            {"name": "Qualifications",  "date": "2026-07-18T16:00:00+02:00"},
            {"name": "Course",          "date": "2026-07-19T15:00:00+02:00"},
        ]
    },
    {
        "round": 13, "name": "Grand Prix de Hongrie",         "location": "Budapest",
        "country": "Hongrie",      "country_code": "HU",
        "circuit": "Hungaroring",
        "date_start": "2026-07-31", "date_end": "2026-08-02",
        "sprint": False, "cancelled": False,
        "meeting_key": 1299,
        "circuit_id": "hungaroring",
        "circuit_laps": 70,
        "circuit_length_km": 4.381,
        "circuit_first_gp": 1986,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-07-31T13:30:00+02:00"},
            {"name": "Essais Libres 2", "date": "2026-07-31T17:00:00+02:00"},
            {"name": "Essais Libres 3", "date": "2026-08-01T12:30:00+02:00"},
            {"name": "Qualifications",  "date": "2026-08-01T16:00:00+02:00"},
            {"name": "Course",          "date": "2026-08-02T15:00:00+02:00"},
        ]
    },
    {
        "round": 14, "name": "Grand Prix des Pays-Bas",       "location": "Zandvoort",
        "country": "Pays-Bas",     "country_code": "NL",
        "circuit": "Circuit Zandvoort",
        "date_start": "2026-08-28", "date_end": "2026-08-30",
        "sprint": False, "cancelled": False,
        "meeting_key": 1301,
        "circuit_id": "zandvoort",
        "circuit_laps": 72,
        "circuit_length_km": 4.259,
        "circuit_first_gp": 1952,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-08-28T11:30:00+02:00"},
            {"name": "Essais Libres 2", "date": "2026-08-28T15:00:00+02:00"},
            {"name": "Essais Libres 3", "date": "2026-08-29T10:30:00+02:00"},
            {"name": "Qualifications",  "date": "2026-08-29T14:00:00+02:00"},
            {"name": "Course",          "date": "2026-08-30T15:00:00+02:00"},
        ]
    },
    {
        "round": 15, "name": "Grand Prix d'Italie",            "location": "Monza",
        "country": "Italie",       "country_code": "IT",
        "circuit": "Autodromo Nazionale Monza",
        "date_start": "2026-09-04", "date_end": "2026-09-06",
        "sprint": False, "cancelled": False,
        "meeting_key": 1283,
        "circuit_id": "monza",
        "circuit_laps": 53,
        "circuit_length_km": 5.793,
        "circuit_first_gp": 1950,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-09-04T11:30:00+02:00"},
            {"name": "Essais Libres 2", "date": "2026-09-04T15:00:00+02:00"},
            {"name": "Essais Libres 3", "date": "2026-09-05T10:30:00+02:00"},
            {"name": "Qualifications",  "date": "2026-09-05T14:00:00+02:00"},
            {"name": "Course",          "date": "2026-09-06T15:00:00+02:00"},
        ]
    },
    {
        "round": 16, "name": "Grand Prix d'Azerbaïdjan",       "location": "Bakou",
        "country": "Azerbaïdjan",  "country_code": "AZ",
        "circuit": "Baku City Circuit",
        "date_start": "2026-09-18", "date_end": "2026-09-20",
        "sprint": False, "cancelled": False,
        "meeting_key": 1295,
        "circuit_id": "baku",
        "circuit_laps": 51,
        "circuit_length_km": 6.003,
        "circuit_first_gp": 2017,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-09-18T11:30:00+04:00"},
            {"name": "Essais Libres 2", "date": "2026-09-18T15:00:00+04:00"},
            {"name": "Essais Libres 3", "date": "2026-09-19T10:30:00+04:00"},
            {"name": "Qualifications",  "date": "2026-09-19T14:00:00+04:00"},
            {"name": "Course",          "date": "2026-09-20T14:00:00+04:00"},
        ]
    },
    {
        "round": 17, "name": "Grand Prix de Singapour",        "location": "Singapour",
        "country": "Singapour",    "country_code": "SG",
        "circuit": "Marina Bay Street Circuit",
        "date_start": "2026-10-02", "date_end": "2026-10-04",
        "sprint": False, "cancelled": False,
        "meeting_key": 1283,
        "circuit_id": "marina_bay",
        "circuit_laps": 62,
        "circuit_length_km": 5.063,
        "circuit_first_gp": 2008,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-10-02T17:30:00+08:00"},
            {"name": "Essais Libres 2", "date": "2026-10-02T21:00:00+08:00"},
            {"name": "Essais Libres 3", "date": "2026-10-03T17:30:00+08:00"},
            {"name": "Qualifications",  "date": "2026-10-03T21:00:00+08:00"},
            {"name": "Course",          "date": "2026-10-04T20:00:00+08:00"},
        ]
    },
    {
        "round": 18, "name": "Grand Prix des États-Unis",      "location": "Austin",
        "country": "États-Unis",   "country_code": "US",
        "circuit": "Circuit of The Americas",
        "date_start": "2026-10-16", "date_end": "2026-10-18",
        "sprint": True, "cancelled": False,
        "meeting_key": 1305,
        "circuit_id": "americas",
        "circuit_laps": 56,
        "circuit_length_km": 5.513,
        "circuit_first_gp": 2012,
        "sessions": [
            {"name": "Essais Libres 1",  "date": "2026-10-16T19:30:00-05:00"},
            {"name": "Sprint Qualifying","date": "2026-10-16T23:30:00-05:00"},
            {"name": "Sprint",           "date": "2026-10-17T19:00:00-05:00"},
            {"name": "Qualifications",   "date": "2026-10-17T23:00:00-05:00"},
            {"name": "Course",           "date": "2026-10-18T19:00:00-05:00"},
        ]
    },
    {
        "round": 19, "name": "Grand Prix du Mexique",          "location": "Mexico",
        "country": "Mexique",      "country_code": "MX",
        "circuit": "Autodromo Hermanos Rodriguez",
        "date_start": "2026-10-23", "date_end": "2026-10-25",
        "sprint": False, "cancelled": False,
        "meeting_key": 1307,
        "circuit_id": "rodriguez",
        "circuit_laps": 71,
        "circuit_length_km": 4.304,
        "circuit_first_gp": 1963,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-10-23T18:30:00-06:00"},
            {"name": "Essais Libres 2", "date": "2026-10-23T22:00:00-06:00"},
            {"name": "Essais Libres 3", "date": "2026-10-24T17:30:00-06:00"},
            {"name": "Qualifications",  "date": "2026-10-24T21:00:00-06:00"},
            {"name": "Course",          "date": "2026-10-25T20:00:00-06:00"},
        ]
    },
    {
        "round": 20, "name": "Grand Prix du Brésil",           "location": "São Paulo",
        "country": "Brésil",       "country_code": "BR",
        "circuit": "Autodromo Jose Carlos Pace (Interlagos)",
        "date_start": "2026-11-06", "date_end": "2026-11-08",
        "sprint": True, "cancelled": False,
        "meeting_key": 1309,
        "circuit_id": "interlagos",
        "circuit_laps": 71,
        "circuit_length_km": 4.309,
        "circuit_first_gp": 1973,
        "sessions": [
            {"name": "Essais Libres 1",  "date": "2026-11-06T14:30:00-03:00"},
            {"name": "Sprint Qualifying","date": "2026-11-06T18:30:00-03:00"},
            {"name": "Sprint",           "date": "2026-11-07T14:00:00-03:00"},
            {"name": "Qualifications",   "date": "2026-11-07T18:00:00-03:00"},
            {"name": "Course",           "date": "2026-11-08T17:00:00-03:00"},
        ]
    },
    {
        "round": 21, "name": "Grand Prix de Las Vegas",        "location": "Las Vegas",
        "country": "États-Unis",   "country_code": "US",
        "circuit": "Las Vegas Strip Circuit",
        "date_start": "2026-11-19", "date_end": "2026-11-21",
        "sprint": False, "cancelled": False,
        "meeting_key": 1311,
        "circuit_id": "vegas",
        "circuit_laps": 50,
        "circuit_length_km": 6.201,
        "circuit_first_gp": 2023,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-11-19T22:30:00-08:00"},
            {"name": "Essais Libres 2", "date": "2026-11-20T02:00:00-08:00"},
            {"name": "Essais Libres 3", "date": "2026-11-20T22:30:00-08:00"},
            {"name": "Qualifications",  "date": "2026-11-21T02:00:00-08:00"},
            {"name": "Course",          "date": "2026-11-21T22:00:00-08:00"},
        ]
    },
    {
        "round": 22, "name": "Grand Prix du Qatar",            "location": "Lusail",
        "country": "Qatar",        "country_code": "QA",
        "circuit": "Losail International Circuit",
        "date_start": "2026-11-27", "date_end": "2026-11-29",
        "sprint": True, "cancelled": False,
        "meeting_key": 1313,
        "circuit_id": "losail",
        "circuit_laps": 57,
        "circuit_length_km": 5.38,
        "circuit_first_gp": 2021,
        "sessions": [
            {"name": "Essais Libres 1",  "date": "2026-11-27T16:30:00+03:00"},
            {"name": "Sprint Qualifying","date": "2026-11-27T20:30:00+03:00"},
            {"name": "Sprint",           "date": "2026-11-28T17:00:00+03:00"},
            {"name": "Qualifications",   "date": "2026-11-28T21:00:00+03:00"},
            {"name": "Course",           "date": "2026-11-29T20:00:00+03:00"},
        ]
    },
    {
        "round": 23, "name": "Grand Prix d'Abou Dabi",         "location": "Yas Marina",
        "country": "Émirats Arabes Unis", "country_code": "AE",
        "circuit": "Yas Marina Circuit",
        "date_start": "2026-12-04", "date_end": "2026-12-06",
        "sprint": False, "cancelled": False,
        "meeting_key": 1302,
        "circuit_id": "yas_marina",
        "circuit_laps": 58,
        "circuit_length_km": 5.281,
        "circuit_first_gp": 2009,
        "sessions": [
            {"name": "Essais Libres 1", "date": "2026-12-04T13:30:00+04:00"},
            {"name": "Essais Libres 2", "date": "2026-12-04T17:00:00+04:00"},
            {"name": "Essais Libres 3", "date": "2026-12-05T13:30:00+04:00"},
            {"name": "Qualifications",  "date": "2026-12-05T17:00:00+04:00"},
            {"name": "Course",          "date": "2026-12-06T17:00:00+04:00"},
        ]
    },
]


def get_driver_color(driver_number: int, theme: str = "dark") -> str:
    driver = DRIVERS_2026.get(driver_number)
    if not driver:
        return "#FFFFFF"
    team = TEAMS_2026.get(driver["team"], {})
    if theme == "light" and "color_light" in team:
        return team["color_light"]
    return team.get("color", "#FFFFFF")


# ─── Constantes partagées avec les services de sync (standings_sync, results_sync) ─

# Saison courante (E2) — centralisée pour éviter le SEASON=2026 dupliqué dans chaque sync.
SEASON = 2026

# Normalisation des noms d'écuries (E2) — Ergast → noms internes f1_2026.py.
# Une seule source de vérité au lieu de deux copies identiques.
TEAM_NAME_MAP = {
    "Mercedes":         "Mercedes",
    "Red Bull":         "Red Bull",
    "Ferrari":          "Ferrari",
    "McLaren":          "McLaren",
    "Aston Martin":     "Aston Martin",
    "Alpine F1 Team":   "Alpine",
    "Alpine":           "Alpine",
    "Haas F1 Team":     "Haas",
    "Williams":         "Williams",
    "RB F1 Team":       "Racing Bulls",
    "Racing Bulls":     "Racing Bulls",
    "Visa Cash App RB": "Racing Bulls",
    "Audi":             "Audi",
    "Kick Sauber":      "Audi",
    "Sauber":           "Audi",
    "Cadillac":         "Cadillac",
    "Andretti Global":  "Cadillac",
}



def get_static_payload() -> dict:
    return {
        "drivers":           DRIVERS_2026,
        "teams":             TEAMS_2026,
        "calendar":          CALENDAR_2026,
        "drivers_standings": DRIVERS_STANDINGS_2026,
        "teams_standings":   TEAMS_STANDINGS_2026,
    }