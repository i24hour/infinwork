import SwiftUI
import WidgetKit

struct SettingsView: View {
    @State private var token = WidgetClient.token
    @State private var baseURL = WidgetClient.baseURL
    @State private var status = "Paste the key from infinWORK Settings. The Android widget uses this same key."
    @State private var checking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("infinWORK")
                .font(.largeTitle.bold())
            Text("After you save the key, add infinWORK from the widget gallery in Notification Center or on the desktop. This window is where the key is pasted. The widget then shows the live score and the running task from the site.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Text("Widget key")
                .font(.headline)
            TextField("inw_…", text: $token)
                .textFieldStyle(.roundedBorder)

            Text("Site")
                .font(.headline)
            TextField("https://infinwork.app", text: $baseURL)
                .textFieldStyle(.roundedBorder)

            HStack {
                Button("Save key") {
                    save()
                }
                .keyboardShortcut(.defaultAction)

                Button(checking ? "Checking…" : "Check connection") {
                    check()
                }
                .disabled(checking)
            }

            Text(status)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func save() {
        WidgetClient.save(token: token, baseURL: baseURL)
        token = WidgetClient.token
        baseURL = WidgetClient.baseURL
        WidgetCenter.shared.reloadAllTimelines()
        status = "Saved. Add the infinWORK widget from the widget gallery."
    }

    private func check() {
        WidgetClient.save(token: token, baseURL: baseURL)
        token = WidgetClient.token
        baseURL = WidgetClient.baseURL
        checking = true
        WidgetClient.load { snapshot in
            DispatchQueue.main.async {
                checking = false
                if snapshot.hasLiveData {
                    status = String(format: "Connected as %@. Score %.2f.", snapshot.username, snapshot.score)
                    WidgetCenter.shared.reloadAllTimelines()
                } else {
                    status = snapshot.message ?? "Couldn't refresh"
                }
            }
        }
    }
}
