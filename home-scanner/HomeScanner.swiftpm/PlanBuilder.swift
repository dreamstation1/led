import Foundation
import RoomPlan
import simd

/// 웹 플래너(우리집 3D 플래너)가 읽는 도면 형식. 단위는 cm, x는 오른쪽, y는 아래쪽.
struct PlanExport: Codable {
    var name: String
    var wallH: Int
    var unit = "cm"
    var source = "roomplan"
    var rooms: [Room]
    var items: [Item]

    struct Room: Codable {
        var name: String
        var x: Int
        var y: Int
        var w: Int
        var d: Int
        var floor: String
        /// 방 왼쪽 위 모서리 기준 벽 선분 (실제 스캔한 벽 모양)
        var walls: [Wall]
    }

    struct Wall: Codable {
        var x1: Int
        var y1: Int
        var x2: Int
        var y2: Int
    }

    struct Item: Codable {
        var type: String
        var name: String
        var x: Int
        var y: Int
        var w: Int
        var d: Int
        var h: Int
        var z: Int
        var rot: Int
        var color: String
    }
}

struct ScannedRoom: Identifiable, Codable {
    var id = UUID()
    var name: String
    var room: CapturedRoom
}

enum PlanBuilder {
    /// 스캔한 방들을 가로로 나란히 놓아서 하나의 도면으로 만들어요. 위치는 플래너에서 끌어서 맞추면 돼요.
    static func build(name: String, scans: [ScannedRoom]) -> PlanExport {
        var rooms: [PlanExport.Room] = []
        var items: [PlanExport.Item] = []
        var cursorX = 0
        var wallH = 240
        for scan in scans {
            let converted = convert(scan.room, name: scan.name, originX: cursorX)
            rooms.append(converted.room)
            items.append(contentsOf: converted.items)
            wallH = max(wallH, converted.wallH)
            cursorX += converted.room.w + 100
        }
        return PlanExport(name: name, wallH: wallH, rooms: rooms, items: items)
    }

    static func json(_ plan: PlanExport) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(plan) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: - 변환

    /// 평면(위에서 본) 좌표. RoomPlan의 x → 도면 x, z → 도면 y.
    private struct P { var x: Double; var y: Double }

    private static func position(_ t: simd_float4x4) -> P {
        P(x: Double(t.columns.3.x), y: Double(t.columns.3.z))
    }

    /// 물체의 가로 방향(로컬 x축)이 도면에서 향하는 각도 (라디안)
    private static func heading(_ t: simd_float4x4) -> Double {
        atan2(Double(t.columns.0.z), Double(t.columns.0.x))
    }

    private static func convert(_ room: CapturedRoom, name: String, originX: Int)
        -> (room: PlanExport.Room, items: [PlanExport.Item], wallH: Int)
    {
        // 1) 가장 긴 벽이 가로/세로에 맞도록 전체를 돌릴 각도
        let longest = room.walls.max { $0.dimensions.x < $1.dimensions.x }
        var align = longest.map { heading($0.transform) } ?? 0
        align = align.truncatingRemainder(dividingBy: .pi / 2)

        func rotate(_ p: P) -> P {
            let c = cos(align), s = sin(align)
            return P(x: p.x * c + p.y * s, y: -p.x * s + p.y * c)
        }

        // 2) 바닥 높이와 천장 높이
        let floorY = room.walls.map { Double($0.transform.columns.3.y - $0.dimensions.y / 2) }.min() ?? 0
        let wallHeight = room.walls.map { Double($0.dimensions.y) }.max() ?? 2.4

        // 3) 벽 끝점
        var segments: [(P, P)] = []
        for wall in room.walls {
            let c = position(wall.transform)
            let a = heading(wall.transform)
            let half = Double(wall.dimensions.x) / 2
            let p1 = P(x: c.x - cos(a) * half, y: c.y - sin(a) * half)
            let p2 = P(x: c.x + cos(a) * half, y: c.y + sin(a) * half)
            segments.append((rotate(p1), rotate(p2)))
        }

        // 4) 방 테두리 (벽이 없으면 가구 위치로)
        var pts = segments.flatMap { [$0.0, $0.1] }
        if pts.isEmpty { pts = room.objects.map { rotate(position($0.transform)) } }
        if pts.isEmpty { pts = [P(x: 0, y: 0), P(x: 3, y: 3)] }
        let minX = pts.map(\.x).min()!, maxX = pts.map(\.x).max()!
        let minY = pts.map(\.y).min()!, maxY = pts.map(\.y).max()!

        func cm(_ v: Double) -> Int { Int((v * 100).rounded()) }
        func local(_ p: P) -> (Int, Int) { (cm(p.x - minX), cm(p.y - minY)) }

        let walls = segments.map { s -> PlanExport.Wall in
            let a = local(s.0), b = local(s.1)
            return PlanExport.Wall(x1: a.0, y1: a.1, x2: b.0, y2: b.1)
        }

        let roomName = name.isEmpty ? sectionName(room) : name
        let planRoom = PlanExport.Room(
            name: roomName,
            x: originX, y: 0,
            w: max(50, cm(maxX - minX)), d: max(50, cm(maxY - minY)),
            floor: floorColor(roomName),
            walls: walls
        )

        func degrees(_ t: simd_float4x4) -> Int {
            var deg = (heading(t) - align) * 180 / .pi
            deg = deg.truncatingRemainder(dividingBy: 360)
            if deg < 0 { deg += 360 }
            // 거의 직각이면 딱 맞춰 줘요
            let nearest = (deg / 90).rounded() * 90
            if abs(deg - nearest) < 8 { deg = nearest }
            return Int(deg.rounded()) % 360
        }

        func item(_ t: simd_float4x4, _ dim: simd_float3, type: String, name: String, color: String, z: Int = 0) -> PlanExport.Item {
            let (x, y) = local(rotate(position(t)))
            return PlanExport.Item(
                type: type, name: name,
                x: x + originX, y: y,
                w: max(1, cm(Double(dim.x))), d: max(1, cm(Double(dim.z))), h: max(1, cm(Double(dim.y))),
                z: z, rot: degrees(t), color: color
            )
        }

        var items: [PlanExport.Item] = []

        for door in room.doors {
            items.append(item(door.transform, door.dimensions, type: "door", name: "문", color: "#B89A76"))
        }
        for opening in room.openings {
            items.append(item(opening.transform, opening.dimensions, type: "door", name: "개구부", color: "#D8D2C6"))
        }
        for window in room.windows {
            let bottom = Double(window.transform.columns.3.y - window.dimensions.y / 2) - floorY
            items.append(item(window.transform, window.dimensions, type: "window", name: "창문", color: "#A9CBE0", z: max(0, cm(bottom))))
        }
        for object in room.objects {
            let info = describe(object.category)
            let bottom = Double(object.transform.columns.3.y - object.dimensions.y / 2) - floorY
            var it = item(object.transform, object.dimensions, type: info.type, name: info.name, color: info.color)
            if bottom > 0.15 { it.z = cm(bottom) } // 벽걸이 TV 등
            items.append(it)
        }

        // 문·창은 두께를 얇게
        for i in items.indices where items[i].type == "door" || items[i].type == "window" {
            items[i].d = 8
        }

        return (planRoom, items, cm(wallHeight))
    }

    private static func describe(_ category: CapturedRoom.Object.Category) -> (type: String, name: String, color: String) {
        switch category {
        case .bed: return ("bed", "침대", "#E8E4DC")
        case .sofa: return ("sofa", "소파", "#8A8F94")
        case .table: return ("table", "테이블", "#B08A62")
        case .chair: return ("chair", "의자", "#6E655C")
        case .storage: return ("cabinet", "수납장", "#EDEAE4")
        case .refrigerator: return ("cabinet", "냉장고", "#D4D7D9")
        case .stove: return ("cabinet", "가스레인지", "#3A3A3A")
        case .oven: return ("cabinet", "오븐", "#3A3A3A")
        case .dishwasher: return ("cabinet", "식기세척기", "#D4D7D9")
        case .sink: return ("cabinet", "싱크대", "#F2F2F0")
        case .washerDryer: return ("cabinet", "세탁기", "#E6E8EA")
        case .toilet: return ("cabinet", "변기", "#FAFAFA")
        case .bathtub: return ("cabinet", "욕조", "#FAFAFA")
        case .television: return ("cabinet", "TV", "#1E1E1E")
        case .fireplace: return ("cabinet", "벽난로", "#8C6B55")
        case .stairs: return ("cabinet", "계단", "#B9B2A8")
        @unknown default: return ("cabinet", "가구", "#B9B2A8")
        }
    }

    private static func sectionName(_ room: CapturedRoom) -> String {
        guard let label = room.sections.first?.label else { return "스캔한 방" }
        switch label {
        case .bedroom: return "침실"
        case .bathroom: return "욕실"
        case .kitchen: return "주방"
        case .livingRoom: return "거실"
        case .diningRoom: return "식당"
        default: return "스캔한 방"
        }
    }

    private static func floorColor(_ name: String) -> String {
        if name.contains("욕실") || name.contains("화장실") { return "#C9D3D6" }
        if name.contains("주방") || name.contains("부엌") { return "#CFCBC2" }
        if name.contains("현관") || name.contains("베란다") { return "#B9B4AA" }
        if name.contains("거실") { return "#D9C4A2" }
        return "#D6C2A0"
    }
}
