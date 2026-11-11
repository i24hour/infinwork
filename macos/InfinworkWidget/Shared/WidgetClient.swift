import Foundation

struct WidgetRunningTask: Codable {
    var title: String
    var elapsedSeconds: Int
    var startedAt: Int64?
}

struct WidgetSnapshot: Codable {
    var username: String
    var score: Double
    var focusTodaySeconds: Int
    var runningCount: Int
    var running: [WidgetRunningTask]
    var updatedAt: String
    var updatedAtMs: Int64
    var message: String?

    static let placeholder = WidgetSnapshot(
        username: "infinWORK",
        score: 12.4,
        focusTodaySeconds: 5400,
        runningCount: 1,
        running: [WidgetRunningTask(title: "Running task", elapsedSeconds: 1250, startedAt: nil)],
        updatedAt: "",
        updatedAtMs: 1_700_000_000_000,
        message: nil
    )

    static let needsKey = WidgetSnapshot(
        username: "infinWORK",
        score: 0,
        focusTodaySeconds: 0,
        runningCount: 0,
        running: [],
        updatedAt: "",
        updatedAtMs: 0,
        message: "Add your widget key in the infinWORK Mac app."
    )

    var hasLiveData: Bool { updatedAtMs > 0 }
}

enum WidgetClient {
    static let appGroup = "group.app.infinwork.widget"
    static let defaultBase = "https://infinwork.app"
    private static let tokenKey = "widgetToken"
    private static let baseKey = "widgetBaseURL"
    private static let snapshotKey = "lastSnapshot"

    static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }

    static var token: String {
        defaults.string(forKey: tokenKey) ?? ""
    }

    static var baseURL: String {
        normalizeBase(defaults.string(forKey: baseKey))
    }

    static func save(token: String, baseURL: String) {
        defaults.set(token.trimmingCharacters(in: .whitespacesAndNewlines), forKey: tokenKey)
        defaults.set(normalizeBase(baseURL), forKey: baseKey)
    }

    static func load(completion: @escaping (WidgetSnapshot) -> Void) {
        let currentToken = token
        guard !currentToken.isEmpty else {
            completion(.needsKey)
            return
        }

        guard let url = URL(string: baseURL + "/api/widget") else {
            completion(cached(or: "Site address is not valid."))
            return
        }

        var request = URLRequest(url: url, timeoutInterval: 20)
        request.setValue("Bearer \(currentToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        URLSession.shared.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(status), let data, let snapshot = decode(data) {
                defaults.set(data, forKey: snapshotKey)
                completion(snapshot)
                return
            }
            let serverMessage = data.flatMap { try? JSONDecoder().decode([String: String].self, from: $0) }?["error"]
            completion(cached(or: serverMessage ?? "Couldn't refresh"))
        }.resume()
    }

    private static func decode(_ data: Data) -> WidgetSnapshot? {
        try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    private static func cached(or message: String) -> WidgetSnapshot {
        if let data = defaults.data(forKey: snapshotKey), var snapshot = decode(data), snapshot.hasLiveData {
            snapshot.message = message
            return snapshot
        }
        return WidgetSnapshot(
            username: "infinWORK",
            score: 0,
            focusTodaySeconds: 0,
            runningCount: 0,
            running: [],
            updatedAt: "",
            updatedAtMs: 0,
            message: message
        )
    }

    private static func normalizeBase(_ raw: String?) -> String {
        var value = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty {
            value = defaultBase
        }
        if !value.hasPrefix("https://") && !value.hasPrefix("http://") {
            value = "https://" + value
        }
        while value.hasSuffix("/") {
            value.removeLast()
        }
        return value
    }
}
