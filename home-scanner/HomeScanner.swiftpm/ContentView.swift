import SwiftUI
import RoomPlan
import UIKit

/// 웹 플래너 주소. 스캔 데이터를 복사한 뒤 여기서 ‘도면 데이터 → 방으로 추가’에 붙여 넣어요.
let plannerURL = URL(string: "https://claude.ai/artifact/3WQV259wPgEmK7XhpBjjhR")!

struct ContentView: View {
    @State private var scans: [ScannedRoom] = ScanStore.load()
    @State private var homeName = "우리집"
    @State private var nextRoomName = ""
    @State private var scanning = false
    @State private var copied = false

    private let supported = RoomCaptureSession.isSupported

    var body: some View {
        NavigationStack {
            List {
                if !supported {
                    Section {
                        Label("이 기기에는 LiDAR 센서가 없어서 스캔할 수 없어요. iPhone 12 Pro 이상의 Pro 모델이나 LiDAR가 있는 iPad Pro가 필요해요.", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                }

                Section("집 이름") {
                    TextField("우리집", text: $homeName)
                }

                Section {
                    TextField("다음에 스캔할 방 이름 (예: 거실)", text: $nextRoomName)
                    Button {
                        scanning = true
                    } label: {
                        Label("방 스캔 시작", systemImage: "viewfinder")
                    }
                    .disabled(!supported)
                } header: {
                    Text("스캔")
                } footer: {
                    Text("방 하나씩 스캔하는 게 가장 정확해요. 방 가운데에서 시작해 천천히 한 바퀴 돌며 벽 모서리, 문, 창, 가구를 비춰 주세요. 밝게 켜 두면 더 잘 돼요.")
                }

                Section("스캔한 방 \(scans.count)개") {
                    if scans.isEmpty {
                        Text("아직 스캔한 방이 없어요.").foregroundStyle(.secondary)
                    }
                    ForEach(scans) { scan in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(scan.name).font(.headline)
                            Text(summary(scan.room)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .onDelete { idx in
                        scans.remove(atOffsets: idx)
                        ScanStore.save(scans)
                    }
                }

                Section {
                    Button {
                        UIPasteboard.general.string = planJSON
                        copied = true
                    } label: {
                        Label(copied ? "복사했어요" : "도면 데이터 복사", systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                    .disabled(scans.isEmpty)

                    ShareLink(item: planJSON) {
                        Label("도면 데이터 공유", systemImage: "square.and.arrow.up")
                    }
                    .disabled(scans.isEmpty)

                    Link(destination: plannerURL) {
                        Label("우리집 3D 플래너 열기", systemImage: "safari")
                    }
                } header: {
                    Text("플래너로 보내기")
                } footer: {
                    Text("① 도면 데이터 복사 → ② 플래너 열기 → ③ 위쪽 ‘도면 데이터’ 버튼 → ④ 붙여 넣고 ‘방으로 추가’. 방들은 옆으로 나란히 들어가니 플래너에서 끌어서 맞춰 주세요. 채팅에 붙여 넣으면 Claude가 바로 인테리어를 추천해 줘요.")
                }
            }
            .navigationTitle("우리집 스캐너")
            .fullScreenCover(isPresented: $scanning) {
                ScanScreen(roomName: nextRoomName) { room in
                    let name = nextRoomName.trimmingCharacters(in: .whitespaces)
                    scans.append(ScannedRoom(name: name.isEmpty ? "방 \(scans.count + 1)" : name, room: room))
                    ScanStore.save(scans)
                    nextRoomName = ""
                    copied = false
                }
            }
        }
    }

    private var planJSON: String {
        PlanBuilder.json(PlanBuilder.build(name: homeName, scans: scans))
    }

    private func summary(_ room: CapturedRoom) -> String {
        let plan = PlanBuilder.build(name: "", scans: [ScannedRoom(name: "", room: room)])
        guard let r = plan.rooms.first else { return "" }
        let m2 = Double(r.w * r.d) / 10000
        return String(format: "약 %.1f×%.1fm · 벽 %d · 문 %d · 창 %d · 가구 %d",
                      Double(r.w) / 100, Double(r.d) / 100,
                      room.walls.count, room.doors.count, room.windows.count, room.objects.count)
            + String(format: " · 약 %.1f평", m2 / 3.3058)
    }
}

/// 스캔 결과를 앱 안에 보관해서, 앱을 껐다 켜도 남아 있게 해요.
enum ScanStore {
    private static var url: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("scans.json")
    }

    static func load() -> [ScannedRoom] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([ScannedRoom].self, from: data)) ?? []
    }

    static func save(_ scans: [ScannedRoom]) {
        if let data = try? JSONEncoder().encode(scans) {
            try? data.write(to: url, options: .atomic)
        }
    }
}
