// ============================================================
// 道路網路幾何資料（含近似經緯度）
// 座標以信義區為中心，參考真實位置估算
// ============================================================
export const ROAD_SEGMENTS = [
  {
    segment_id: "RD_TPE_001", name: "忠孝東路四段", flow_direction: "東西向",
    intersections: ["延吉街","光復南路","基隆路一段"],
    capacity_vph: 3000, alternatives: ["RD_TPE_004","RD_TPE_005","RD_TPE_007"],
    nearby_stations: ["BS_TPE_DOME","BS_MRT_BL17","BS_MRT_BL16","BS_MRT_BL18"],
    // 路段兩端座標 [lat, lng]
    coords: [[25.0418, 121.5530], [25.0418, 121.5680]],
  },
  {
    segment_id: "RD_TPE_002", name: "光復南路", flow_direction: "南北向",
    intersections: ["市民大道四段","忠孝東路四段","仁愛路四段"],
    capacity_vph: 1800, alternatives: ["RD_TPE_004","RD_TPE_005","RD_TPE_006","RD_TPE_008"],
    nearby_stations: ["BS_TPE_DOME","BS_MRT_BL17","BS_SS_PARK"],
    coords: [[25.0460, 121.5575], [25.0330, 121.5575]],
  },
  {
    segment_id: "RD_TPE_003", name: "基隆路一段", flow_direction: "南北向",
    intersections: ["忠孝東路四段","松高路","信義路五段"],
    capacity_vph: 3500, alternatives: ["RD_TPE_006","RD_TPE_009"],
    nearby_stations: [],
    coords: [[25.0418, 121.5680], [25.0295, 121.5680]],
  },
  {
    segment_id: "RD_TPE_004", name: "市民大道四段", flow_direction: "東西向",
    intersections: ["復興南路一段","敦化南路一段","光復南路"],
    capacity_vph: 2500, alternatives: ["RD_TPE_001","RD_TPE_006"],
    nearby_stations: ["BS_SS_PARK"],
    coords: [[25.0460, 121.5480], [25.0460, 121.5575]],
  },
  {
    segment_id: "RD_TPE_005", name: "仁愛路四段", flow_direction: "東西向",
    intersections: ["敦化南路一段","光復南路","市府路"],
    capacity_vph: 4000, alternatives: ["RD_TPE_001","RD_TPE_010"],
    nearby_stations: [],
    coords: [[25.0330, 121.5480], [25.0330, 121.5680]],
  },
  {
    segment_id: "RD_TPE_006", name: "敦化南路一段", flow_direction: "南北向",
    intersections: ["市民大道四段","忠孝東路四段","仁愛路四段"],
    capacity_vph: 3200, alternatives: ["RD_TPE_002","RD_TPE_004","RD_TPE_008"],
    nearby_stations: ["BS_MRT_BL16"],
    coords: [[25.0460, 121.5480], [25.0330, 121.5480]],
  },
  {
    segment_id: "RD_TPE_007", name: "松高路", flow_direction: "東西向",
    intersections: ["基隆路一段","市府路","松智路"],
    capacity_vph: 1200, alternatives: ["RD_TPE_011"],
    nearby_stations: ["BS_BUS_TERM","BS_XY_VIESHOW"],
    coords: [[25.0380, 121.5650], [25.0380, 121.5750]],
  },
  {
    segment_id: "RD_TPE_008", name: "延吉街", flow_direction: "南北向",
    intersections: ["忠孝東路四段","仁愛路四段"],
    capacity_vph: 600, alternatives: ["RD_TPE_002"],
    nearby_stations: [],
    coords: [[25.0418, 121.5530], [25.0330, 121.5530]],
  },
  {
    segment_id: "RD_TPE_009", name: "基隆路地下道", flow_direction: "南北向",
    intersections: ["忠孝東路四段","正氣橋"],
    capacity_vph: 2800, alternatives: ["RD_TPE_003"],
    nearby_stations: [],
    coords: [[25.0418, 121.5690], [25.0370, 121.5690]],
  },
  {
    segment_id: "RD_TPE_010", name: "市府路", flow_direction: "南北向",
    intersections: ["仁愛路四段","松高路","松壽路"],
    capacity_vph: 2000, alternatives: ["RD_TPE_003","RD_TPE_011"],
    nearby_stations: ["BS_MRT_BL18","BS_BUS_TERM"],
    coords: [[25.0380, 121.5750], [25.0310, 121.5750]],
  },
  {
    segment_id: "RD_TPE_011", name: "松壽路", flow_direction: "東西向",
    intersections: ["基隆路一段","市府路","松智路"],
    capacity_vph: 1500, alternatives: ["RD_TPE_007","RD_TPE_010"],
    nearby_stations: ["BS_XY_VIESHOW","BS_XY_ATT"],
    coords: [[25.0340, 121.5650], [25.0340, 121.5770]],
  },
  {
    segment_id: "RD_TPE_012", name: "敦化南路二段", flow_direction: "南北向",
    intersections: ["仁愛路四段","信義路五段"],
    capacity_vph: 3200, alternatives: ["RD_TPE_006"],
    nearby_stations: [],
    coords: [[25.0330, 121.5480], [25.0250, 121.5480]],
  },
  {
    segment_id: "RD_TPE_013", name: "信義路五段", flow_direction: "東西向",
    intersections: ["基隆路一段","市府路","松智路"],
    capacity_vph: 3800, alternatives: ["RD_TPE_005"],
    nearby_stations: ["BS_TPE_101"],
    coords: [[25.0295, 121.5650], [25.0295, 121.5770]],
  },
  {
    segment_id: "RD_TPE_014", name: "松智路", flow_direction: "南北向",
    intersections: ["松高路","松壽路","信義路五段"],
    capacity_vph: 1000, alternatives: ["RD_TPE_010"],
    nearby_stations: ["BS_XY_ATT","BS_TPE_101"],
    coords: [[25.0380, 121.5770], [25.0295, 121.5770]],
  },
  {
    segment_id: "RD_TPE_015", name: "復興南路一段", flow_direction: "南北向",
    intersections: ["市民大道四段","忠孝東路四段"],
    capacity_vph: 2800, alternatives: ["RD_TPE_006"],
    nearby_stations: [],
    coords: [[25.0460, 121.5430], [25.0418, 121.5430]],
  },
]

// ============================================================
// 捷運站與地標
// ============================================================
export const STATIONS = [
  { id: "BS_MRT_BL17", name: "捷運國父紀念館站", type: "mrt", coords: [25.0408, 121.5576] },
  { id: "BS_MRT_BL16", name: "捷運忠孝敦化站",   type: "mrt", coords: [25.0415, 121.5483] },
  { id: "BS_MRT_BL18", name: "捷運市政府站",     type: "mrt", coords: [25.0406, 121.5659] },
  { id: "BS_TPE_DOME", name: "大巨蛋",            type: "venue", coords: [25.0357, 121.5573] },
  { id: "BS_TPE_101",  name: "台北101",            type: "landmark", coords: [25.0339, 121.5645] },
  { id: "BS_XY_VIESHOW", name: "信義威秀",         type: "venue", coords: [25.0380, 121.5680] },
  { id: "BS_XY_ATT",  name: "ATT4FUN",             type: "venue", coords: [25.0368, 121.5680] },
  { id: "BS_BUS_TERM", name: "市府轉運站",          type: "bus",   coords: [25.0405, 121.5660] },
  { id: "BS_SS_PARK", name: "松山文創園區",          type: "venue", coords: [25.0462, 121.5605] },
]


// ============================================================
// 事件資料
// ============================================================
export const INCIDENTS = [
  {
    event_id: "TPE_2026_ACC_001",
    type: "Road_Collapse_Accident",
    location: "光復南路與忠孝東路口南側",
    affected_segment: "RD_TPE_002",
    status: "Closed", severity: "Critical",
    description: "2026-05-20 22:10 發生地下管線爆裂導致路面塌陷並引發三車連環追撞，光復南路南下全線封鎖",
    timestamp: "2026-05-20 22:10",
    coords: [25.0418, 121.5575],
  },
  {
    event_id: "TPE_2026_EVT_002",
    type: "Crowd_Surge_Injury",
    location: "捷運國父紀念館站 5 號出口",
    affected_segment: "BS_MRT_BL17",
    affected_road: "RD_TPE_001",
    status: "Restricted", severity: "High",
    description: "2026-05-20 22:20 散場人群推擠受傷，救護車佔用單向車道，人流進站動線中斷",
    timestamp: "2026-05-20 22:20",
    coords: [25.0408, 121.5576],
  },
  {
    event_id: "TPE_2026_EVT_003",
    type: "Power_Failure",
    location: "信義威秀/ATT4FUN周邊路燈號誌故障",
    affected_segment: "RD_TPE_007",
    status: "Caution", severity: "Medium",
    description: "2026-05-20 22:30 信義區部分路段號誌失效，需改由人工交通指揮",
    timestamp: "2026-05-20 22:30",
    coords: [25.0378, 121.5720],
  },
]

// ============================================================
// 交通流量時間序列資料
// ============================================================
export const TRAFFIC_FLOW = [
  { ts:"2026-05-20 17:00", id:"RD_TPE_001", speed:42, count:1250, sat:0.58, status:"Normal" },
  { ts:"2026-05-20 17:00", id:"RD_TPE_002", speed:38, count:820,  sat:0.62, status:"Normal" },
  { ts:"2026-05-20 17:00", id:"RD_TPE_003", speed:32, count:1550, sat:0.78, status:"Normal" },
  { ts:"2026-05-20 17:00", id:"RD_TPE_004", speed:45, count:1800, sat:0.55, status:"Normal" },
  { ts:"2026-05-20 17:00", id:"RD_TPE_006", speed:40, count:1100, sat:0.50, status:"Normal" },
  { ts:"2026-05-20 18:00", id:"RD_TPE_001", speed:30, count:1600, sat:0.80, status:"Congested" },
  { ts:"2026-05-20 18:00", id:"RD_TPE_003", speed:22, count:1800, sat:0.88, status:"Congested" },
  { ts:"2026-05-20 18:00", id:"RD_TPE_009", speed:25, count:1400, sat:0.82, status:"Congested" },
  { ts:"2026-05-20 19:00", id:"RD_TPE_001", speed:35, count:1400, sat:0.70, status:"Normal" },
  { ts:"2026-05-20 19:00", id:"RD_TPE_005", speed:38, count:1200, sat:0.55, status:"Normal" },
  { ts:"2026-05-20 19:00", id:"RD_TPE_002", speed:42, count:700,  sat:0.42, status:"Normal" },
  { ts:"2026-05-20 19:00", id:"RD_TPE_003", speed:30, count:1600, sat:0.75, status:"Normal" },
  { ts:"2026-05-20 19:00", id:"RD_TPE_004", speed:44, count:1700, sat:0.56, status:"Normal" },
  { ts:"2026-05-20 19:00", id:"RD_TPE_006", speed:38, count:1150, sat:0.55, status:"Normal" },
  { ts:"2026-05-20 20:00", id:"RD_TPE_002", speed:40, count:750,  sat:0.40, status:"Normal" },
  { ts:"2026-05-20 20:00", id:"RD_TPE_001", speed:40, count:1300, sat:0.60, status:"Normal" },
  { ts:"2026-05-20 20:00", id:"RD_TPE_003", speed:33, count:1500, sat:0.74, status:"Normal" },
  { ts:"2026-05-20 20:00", id:"RD_TPE_004", speed:44, count:1750, sat:0.56, status:"Normal" },
  { ts:"2026-05-20 20:00", id:"RD_TPE_005", speed:40, count:1100, sat:0.52, status:"Normal" },
  { ts:"2026-05-20 20:00", id:"RD_TPE_006", speed:39, count:1150, sat:0.54, status:"Normal" },
  { ts:"2026-05-20 21:00", id:"RD_TPE_001", speed:25, count:2100, sat:0.90, status:"Congested" },
  { ts:"2026-05-20 21:00", id:"RD_TPE_002", speed:22, count:1050, sat:0.85, status:"Congested" },
  { ts:"2026-05-20 21:00", id:"RD_TPE_003", speed:26, count:1850, sat:0.85, status:"Congested" },
  { ts:"2026-05-20 21:00", id:"RD_TPE_004", speed:42, count:1900, sat:0.62, status:"Normal" },
  { ts:"2026-05-20 21:00", id:"RD_TPE_005", speed:38, count:1300, sat:0.58, status:"Normal" },
  { ts:"2026-05-20 21:00", id:"RD_TPE_006", speed:36, count:1300, sat:0.62, status:"Normal" },
  { ts:"2026-05-20 21:15", id:"RD_TPE_003", speed:18, count:2100, sat:0.92, status:"Congested" },
  { ts:"2026-05-20 21:15", id:"RD_TPE_007", speed:30, count:600,  sat:0.55, status:"Normal" },
  { ts:"2026-05-20 21:15", id:"RD_TPE_001", speed:18, count:2300, sat:0.93, status:"Congested" },
  { ts:"2026-05-20 21:15", id:"RD_TPE_002", speed:18, count:1150, sat:0.90, status:"Congested" },
  { ts:"2026-05-20 21:15", id:"RD_TPE_004", speed:40, count:2000, sat:0.66, status:"Normal" },
  { ts:"2026-05-20 21:15", id:"RD_TPE_005", speed:38, count:1350, sat:0.58, status:"Normal" },
  { ts:"2026-05-20 21:15", id:"RD_TPE_006", speed:34, count:1400, sat:0.66, status:"Normal" },
  { ts:"2026-05-20 21:30", id:"RD_TPE_001", speed:10, count:2600, sat:0.99, status:"Critical" },
  { ts:"2026-05-20 21:30", id:"RD_TPE_002", speed:12, count:1250, sat:0.98, status:"Critical" },
  { ts:"2026-05-20 21:30", id:"RD_TPE_004", speed:35, count:2400, sat:0.80, status:"Normal" },
  { ts:"2026-05-20 21:30", id:"RD_TPE_010", speed:32, count:950,  sat:0.60, status:"Normal" },
  { ts:"2026-05-20 21:30", id:"RD_TPE_003", speed:16, count:2200, sat:0.93, status:"Congested" },
  { ts:"2026-05-20 21:30", id:"RD_TPE_005", speed:36, count:1450, sat:0.62, status:"Normal" },
  { ts:"2026-05-20 21:30", id:"RD_TPE_006", speed:32, count:1550, sat:0.70, status:"Normal" },
  { ts:"2026-05-20 21:45", id:"RD_TPE_001", speed:7,  count:2750, sat:1.00, status:"Critical" },
  { ts:"2026-05-20 21:45", id:"RD_TPE_002", speed:8,  count:1350, sat:1.00, status:"Critical" },
  { ts:"2026-05-20 21:45", id:"RD_TPE_008", speed:20, count:550,  sat:0.88, status:"Congested" },
  { ts:"2026-05-20 21:45", id:"RD_TPE_003", speed:12, count:2400, sat:0.95, status:"Critical" },
  { ts:"2026-05-20 21:45", id:"RD_TPE_004", speed:38, count:2300, sat:0.78, status:"Normal" },
  { ts:"2026-05-20 21:45", id:"RD_TPE_005", speed:34, count:1600, sat:0.68, status:"Normal" },
  { ts:"2026-05-20 21:45", id:"RD_TPE_006", speed:30, count:1700, sat:0.76, status:"Normal" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_001", speed:5,  count:2900, sat:1.00, status:"Critical" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_002", speed:5,  count:1450, sat:1.00, status:"Critical" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_003", speed:10, count:2400, sat:0.95, status:"Critical" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_004", speed:32, count:2300, sat:0.78, status:"Normal" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_005", speed:30, count:1500, sat:0.65, status:"Normal" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_006", speed:28, count:1800, sat:0.72, status:"Normal" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_007", speed:25, count:700,  sat:0.62, status:"Normal" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_008", speed:22, count:450,  sat:0.80, status:"Normal" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_009", speed:28, count:1600, sat:0.75, status:"Normal" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_010", speed:30, count:900,  sat:0.55, status:"Normal" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_011", speed:25, count:850,  sat:0.70, status:"Normal" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_012", speed:32, count:2000, sat:0.68, status:"Normal" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_013", speed:28, count:2000, sat:0.68, status:"Normal" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_014", speed:28, count:650,  sat:0.72, status:"Normal" },
  { ts:"2026-05-20 22:00", id:"RD_TPE_015", speed:32, count:1900, sat:0.72, status:"Normal" },
  { ts:"2026-05-20 22:10", id:"RD_TPE_002", speed:2,  count:1600, sat:1.00, status:"Accident_Impact" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_001", speed:4,  count:2950, sat:1.00, status:"Critical" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_002", speed:0,  count:1700, sat:1.00, status:"Blocked" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_003", speed:8,  count:2600, sat:0.98, status:"Critical" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_004", speed:25, count:2500, sat:0.85, status:"Congested" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_005", speed:28, count:1700, sat:0.72, status:"Normal" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_006", speed:22, count:2000, sat:0.85, status:"Congested" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_007", speed:22, count:800,  sat:0.72, status:"Normal" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_008", speed:5,  count:650,  sat:1.00, status:"Gridlock" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_009", speed:25, count:1800, sat:0.85, status:"Congested" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_010", speed:28, count:1000, sat:0.65, status:"Normal" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_011", speed:23, count:950,  sat:0.78, status:"Normal" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_012", speed:28, count:2200, sat:0.78, status:"Normal" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_013", speed:25, count:2200, sat:0.78, status:"Normal" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_014", speed:25, count:750,  sat:0.78, status:"Normal" },
  { ts:"2026-05-20 22:15", id:"RD_TPE_015", speed:28, count:2100, sat:0.78, status:"Normal" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_001", speed:3,  count:3100, sat:1.00, status:"Gridlock" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_002", speed:0,  count:1800, sat:1.00, status:"Blocked" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_003", speed:5,  count:2800, sat:1.00, status:"Critical" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_004", speed:12, count:2800, sat:0.95, status:"Critical" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_005", speed:18, count:1800, sat:0.85, status:"Congested" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_006", speed:12, count:2400, sat:0.98, status:"Critical" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_007", speed:18, count:1000, sat:0.85, status:"Congested" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_008", speed:0,  count:700,  sat:1.00, status:"Gridlock" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_009", speed:18, count:2200, sat:0.92, status:"Critical" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_010", speed:25, count:1200, sat:0.72, status:"Normal" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_011", speed:22, count:1050, sat:0.85, status:"Congested" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_012", speed:22, count:2500, sat:0.85, status:"Congested" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_013", speed:22, count:2400, sat:0.85, status:"Congested" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_014", speed:22, count:850,  sat:0.82, status:"Congested" },
  { ts:"2026-05-20 22:30", id:"RD_TPE_015", speed:22, count:1400, sat:0.75, status:"Normal" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_001", speed:4,  count:2800, sat:1.00, status:"Gridlock" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_002", speed:0,  count:1850, sat:1.00, status:"Blocked" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_003", speed:8,  count:2700, sat:0.98, status:"Critical" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_004", speed:8,  count:2900, sat:0.98, status:"Critical" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_005", speed:15, count:1900, sat:0.92, status:"Critical" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_006", speed:10, count:2500, sat:0.99, status:"Critical" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_007", speed:15, count:1100, sat:0.92, status:"Critical" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_008", speed:0,  count:750,  sat:1.00, status:"Gridlock" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_009", speed:10, count:2400, sat:0.98, status:"Critical" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_010", speed:22, count:1400, sat:0.82, status:"Congested" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_011", speed:18, count:1100, sat:0.92, status:"Critical" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_012", speed:20, count:2700, sat:0.92, status:"Critical" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_013", speed:25, count:1800, sat:0.65, status:"Normal" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_014", speed:20, count:900,  sat:0.88, status:"Congested" },
  { ts:"2026-05-20 22:45", id:"RD_TPE_015", speed:20, count:1500, sat:0.82, status:"Congested" },
  { ts:"2026-05-20 23:00", id:"RD_TPE_001", speed:15, count:1800, sat:0.85, status:"Congested" },
  { ts:"2026-05-20 23:00", id:"RD_TPE_002", speed:10, count:1200, sat:0.90, status:"Partial_Open" },
  { ts:"2026-05-20 23:00", id:"RD_TPE_006", speed:28, count:1200, sat:0.60, status:"Normal" },
  { ts:"2026-05-20 23:15", id:"RD_TPE_003", speed:35, count:1200, sat:0.60, status:"Normal" },
]

// ============================================================
// 人流密度資料
// ============================================================
export const CROWD_DENSITY = [
  { ts:"2026-05-20 17:00", id:"BS_TPE_DOME",   name:"大巨蛋",           count:15000, growth:0.05 },
  { ts:"2026-05-20 17:00", id:"BS_MRT_BL17",   name:"捷運國父紀念館站", count:4500,  growth:0.10 },
  { ts:"2026-05-20 17:30", id:"BS_SS_PARK",    name:"松山文創園區",     count:5200,  growth:0.12 },
  { ts:"2026-05-20 18:00", id:"BS_TPE_DOME",   name:"大巨蛋",           count:35000, growth:1.33 },
  { ts:"2026-05-20 18:00", id:"BS_MRT_BL17",   name:"捷運國父紀念館站", count:8500,  growth:0.88 },
  { ts:"2026-05-20 18:30", id:"BS_MRT_BL16",   name:"捷運忠孝敦化站",   count:6200,  growth:0.25 },
  { ts:"2026-05-20 19:00", id:"BS_TPE_DOME",   name:"大巨蛋",           count:40000, growth:0.14 },
  { ts:"2026-05-20 19:30", id:"BS_XY_VIESHOW", name:"信義威秀",         count:12000, growth:0.35 },
  { ts:"2026-05-20 20:00", id:"BS_TPE_101",    name:"台北101廣場",       count:9500,  growth:0.15 },
  { ts:"2026-05-20 21:00", id:"BS_TPE_DOME",   name:"大巨蛋",           count:38000, growth:-0.05 },
  { ts:"2026-05-20 21:15", id:"BS_MRT_BL17",   name:"捷運國父紀念館站", count:12000, growth:0.41 },
  { ts:"2026-05-20 21:30", id:"BS_TPE_DOME",   name:"大巨蛋",           count:32000, growth:-0.16 },
  { ts:"2026-05-20 21:30", id:"BS_MRT_BL17",   name:"捷運國父紀念館站", count:18000, growth:0.50 },
  { ts:"2026-05-20 21:30", id:"BS_BUS_TERM",   name:"市府轉運站",        count:7500,  growth:0.65 },
  { ts:"2026-05-20 21:45", id:"BS_MRT_BL17",   name:"捷運國父紀念館站", count:24000, growth:0.33 },
  { ts:"2026-05-20 21:45", id:"BS_XY_ATT",     name:"ATT4FUN",           count:14000, growth:0.40 },
  { ts:"2026-05-20 22:00", id:"BS_MRT_BL17",   name:"捷運國父紀念館站", count:28500, growth:0.18 },
  { ts:"2026-05-20 22:00", id:"BS_MRT_BL18",   name:"捷運市政府站",     count:15000, growth:1.00 },
  { ts:"2026-05-20 22:00", id:"BS_BUS_TERM",   name:"市府轉運站",        count:11000, growth:0.46 },
  { ts:"2026-05-20 22:00", id:"BS_XY_VIESHOW", name:"信義威秀",         count:18500, growth:0.54 },
  { ts:"2026-05-20 22:00", id:"BS_TPE_DOME",   name:"大巨蛋",           count:22000, growth:-0.31 },
  { ts:"2026-05-20 22:15", id:"BS_TPE_101",    name:"台北101廣場",       count:12000, growth:0.26 },
  { ts:"2026-05-20 22:15", id:"BS_MRT_BL16",   name:"捷運忠孝敦化站",   count:9800,  growth:0.58 },
  { ts:"2026-05-20 22:15", id:"BS_MRT_BL17",   name:"捷運國父紀念館站", count:31000, growth:0.08 },
  { ts:"2026-05-20 22:30", id:"BS_MRT_BL17",   name:"捷運國父紀念館站", count:33000, growth:0.06 },
  { ts:"2026-05-20 22:30", id:"BS_MRT_BL18",   name:"捷運市政府站",     count:22000, growth:0.46 },
  { ts:"2026-05-20 22:30", id:"BS_XY_ATT",     name:"ATT4FUN",           count:16000, growth:0.14 },
  { ts:"2026-05-20 22:30", id:"BS_SS_PARK",    name:"松山文創園區",     count:3500,  growth:-0.60 },
  { ts:"2026-05-20 22:45", id:"BS_MRT_BL17",   name:"捷運國父紀念館站", count:25000, growth:-0.24 },
  { ts:"2026-05-20 22:45", id:"BS_MRT_BL18",   name:"捷運市政府站",     count:26000, growth:0.18 },
  { ts:"2026-05-20 22:45", id:"BS_BUS_TERM",   name:"市府轉運站",        count:14000, growth:0.27 },
  { ts:"2026-05-20 23:00", id:"BS_MRT_BL17",   name:"捷運國父紀念館站", count:12000, growth:-0.52 },
  { ts:"2026-05-20 23:00", id:"BS_MRT_BL18",   name:"捷運市政府站",     count:15000, growth:-0.42 },
  { ts:"2026-05-20 23:00", id:"BS_XY_VIESHOW", name:"信義威秀",         count:11000, growth:-0.40 },
  { ts:"2026-05-20 23:15", id:"BS_BUS_TERM",   name:"市府轉運站",        count:6000,  growth:-0.57 },
  { ts:"2026-05-20 23:30", id:"BS_MRT_BL18",   name:"捷運市政府站",     count:5000,  growth:-0.66 },
]

// 所有時間點（排序後去重）
export const TIME_STEPS = [...new Set(
  [...TRAFFIC_FLOW.map(d => d.ts), ...CROWD_DENSITY.map(d => d.ts)]
)].sort()

// 取得某時間點之前最新的路段狀態
export function getSegmentStateAt(timestamp) {
  const map = {}
  for (const d of TRAFFIC_FLOW) {
    if (d.ts <= timestamp) map[d.id] = d
  }
  return map
}

// 取得某時間點之前最新的人流狀態
export function getCrowdStateAt(timestamp) {
  const map = {}
  for (const d of CROWD_DENSITY) {
    if (d.ts <= timestamp) map[d.id] = d
  }
  return map
}

// 取得某時間點之前發生的事件
export function getActiveIncidents(timestamp) {
  return INCIDENTS.filter(i => i.timestamp <= timestamp)
}

// 狀態 → 顏色
export const STATUS_COLOR = {
  Normal:         '#2ed573',
  Congested:      '#ffa502',
  Critical:       '#ff4757',
  Blocked:        '#2f3542',
  Gridlock:       '#2f3542',
  Accident_Impact:'#ff6b81',
  Partial_Open:   '#eccc68',
  Caution:        '#eccc68',
}

export const STATUS_LABEL = {
  Normal:         '正常',
  Congested:      '壅塞',
  Critical:       '嚴重壅塞',
  Blocked:        '封閉',
  Gridlock:       '塞爆',
  Accident_Impact:'事故影響',
  Partial_Open:   '部分開放',
  Caution:        '注意',
}
