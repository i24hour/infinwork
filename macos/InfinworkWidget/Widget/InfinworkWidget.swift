import SwiftUI
import WidgetKit

struct InfinworkEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct InfinworkProvider: TimelineProvider {
    func placeholder(in context: Context) -> InfinworkEntry {
        InfinworkEntry(date: Date(), snapshot: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (InfinworkEntry) -> Void) {
        WidgetClient.load { snapshot in
            completion(InfinworkEntry(date: Date(), snapshot: snapshot.hasLiveData ? snapshot : .placeholder))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<InfinworkEntry>) -> Void) {
        WidgetClient.load { snapshot in
            let entry = InfinworkEntry(date: Date(), snapshot: snapshot)
            let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(900)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

struct InfinworkWidgetEntryView: View {
    var entry: InfinworkEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let snapshot = entry.snapshot
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("infinWORK")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.7))
                Spacer(minLength: 8)
                Text(snapshot.username)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.55))
                    .lineLimit(1)
            }

            Text(snapshot.hasLiveData ? String(format: "%.2f", snapshot.score) : "—")
                .font(.system(size: family == .systemSmall ? 28 : 36, weight: .bold, design: .rounded))
                .foregroundStyle(snapshot.score < 0 ? Color.red : Color.green)
                .minimumScaleFactor(0.6)

            if snapshot.hasLiveData, let task = snapshot.running.first, snapshot.runningCount > 0 {
                Text(task.title)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(family == .systemSmall ? 1 : 2)
                Text(timerAnchor(task), style: .timer)
                    .font(.title3.monospacedDigit())
                    .foregroundStyle(.white)
                if snapshot.runningCount > 1 {
                    Text("+\(snapshot.runningCount - 1) more")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.65))
                }
            } else if let message = snapshot.message, !snapshot.hasLiveData {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.85))
                    .lineLimit(3)
            } else {
                Text("Idle")
                    .font(.headline)
                    .foregroundStyle(.white.opacity(0.9))
            }

            if let message = snapshot.message, snapshot.hasLiveData {
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(.orange.opacity(0.9))
                    .lineLimit(1)
            }

            Text(focusLabel(snapshot.focusTodaySeconds))
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.65))
        }
        .padding(family == .systemSmall ? 12 : 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(.black, for: .widget)
    }

    private func timerAnchor(_ task: WidgetRunningTask) -> Date {
        Date(timeIntervalSince1970: Double(entry.snapshot.updatedAtMs) / 1000)
            .addingTimeInterval(-Double(task.elapsedSeconds))
    }

    private func focusLabel(_ seconds: Int) -> String {
        let safe = max(0, seconds)
        return "Today \(safe / 3600)h \((safe % 3600) / 60)m"
    }
}

struct InfinworkWidget: Widget {
    let kind = "InfinworkWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: InfinworkProvider()) { entry in
            InfinworkWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("infinWORK")
        .description("Live score and the task that is running.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct InfinworkWidgetBundle: WidgetBundle {
    var body: some Widget {
        InfinworkWidget()
    }
}
