import SwiftUI

@main
struct InfinworkWidgetApp: App {
    var body: some Scene {
        WindowGroup {
            SettingsView()
                .frame(minWidth: 420, minHeight: 360)
        }
        .windowResizability(.contentMinSize)
    }
}
