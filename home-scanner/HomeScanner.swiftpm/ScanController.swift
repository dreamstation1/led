import SwiftUI
import RoomPlan

/// RoomPlan 스캔 화면 하나를 관리해요. 스캔할 때마다 새로 만들어요.
@MainActor
final class ScanController: NSObject, ObservableObject, RoomCaptureViewDelegate {
    enum Phase { case scanning, processing, done, failed(String) }

    let captureView: RoomCaptureView
    @Published var phase: Phase = .scanning
    @Published var result: CapturedRoom?

    override init() {
        captureView = RoomCaptureView(frame: .zero)
        super.init()
        captureView.delegate = self
    }

    // RoomCaptureViewDelegate 가 NSCoding 을 요구해서 넣은 부분이에요. 실제로 쓰이지 않아요.
    required init?(coder: NSCoder) { return nil }
    nonisolated func encode(with coder: NSCoder) {}

    func start() {
        result = nil
        phase = .scanning
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }

    func finish() {
        phase = .processing
        captureView.captureSession.stop()
    }

    func cancel() {
        captureView.captureSession.stop()
    }

    nonisolated func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        true
    }

    nonisolated func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        Task { @MainActor in
            if let error {
                self.phase = .failed(error.localizedDescription)
            } else {
                self.result = processedResult
                self.phase = .done
            }
        }
    }
}

struct CaptureViewContainer: UIViewRepresentable {
    let view: RoomCaptureView
    func makeUIView(context: Context) -> RoomCaptureView { view }
    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
}

/// 전체 화면 스캔 화면
struct ScanScreen: View {
    let roomName: String
    let onSave: (CapturedRoom) -> Void

    @StateObject private var scanner = ScanController()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .bottom) {
            CaptureViewContainer(view: scanner.captureView)
                .ignoresSafeArea()

            VStack(spacing: 12) {
                Text(tip)
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))

                HStack(spacing: 12) {
                    Button("취소", role: .cancel) {
                        scanner.cancel()
                        dismiss()
                    }
                    .buttonStyle(.bordered)

                    switch scanner.phase {
                    case .scanning:
                        Button("스캔 끝내기") { scanner.finish() }
                            .buttonStyle(.borderedProminent)
                    case .processing:
                        ProgressView().padding(.horizontal)
                    case .done:
                        Button("이 방 저장") {
                            if let room = scanner.result { onSave(room) }
                            dismiss()
                        }
                        .buttonStyle(.borderedProminent)
                    case .failed:
                        Button("다시 스캔") { scanner.start() }
                            .buttonStyle(.borderedProminent)
                    }
                }
                .controlSize(.large)
            }
            .padding(.bottom, 24)
            .padding(.horizontal)
        }
        .onAppear { scanner.start() }
    }

    private var tip: String {
        switch scanner.phase {
        case .scanning:
            return "\(roomName.isEmpty ? "방" : roomName) 스캔 중이에요.\n천천히 걸으면서 벽 모서리, 문, 창, 가구를 한 번씩 비춰 주세요."
        case .processing:
            return "도면을 정리하는 중이에요…"
        case .done:
            return "다 됐어요. 3D 모습을 확인하고 저장하세요."
        case .failed(let message):
            return "스캔에 실패했어요: \(message)"
        }
    }
}
