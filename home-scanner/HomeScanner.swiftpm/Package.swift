// swift-tools-version: 5.9

// 이 파일은 Xcode / Swift Playgrounds가 읽는 앱 설정이에요.
// 직접 고칠 일은 거의 없지만, bundleIdentifier 는 본인만의 값으로 바꿔도 돼요.

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "HomeScanner",
    platforms: [
        .iOS("17.0")
    ],
    products: [
        .iOSApplication(
            name: "우리집 스캐너",
            targets: ["AppModule"],
            bundleIdentifier: "com.homeplanner.scanner",
            teamIdentifier: "",
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .house),
            accentColor: .presetColor(.green),
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .portrait
            ],
            capabilities: [
                .camera(purposeString: "방을 LiDAR로 스캔해서 도면을 만들기 위해 카메라를 사용해요.")
            ]
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: "."
        )
    ]
)
