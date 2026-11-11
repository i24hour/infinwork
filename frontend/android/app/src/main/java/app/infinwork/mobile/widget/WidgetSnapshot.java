package app.infinwork.mobile.widget;

import org.json.JSONArray;
import org.json.JSONObject;

final class WidgetSnapshot {
    final String username;
    final double score;
    final int focusTodaySeconds;
    final int runningCount;
    final String title;
    final int elapsedSeconds;
    final long updatedAtMs;
    final String message;

    private WidgetSnapshot(
            String username,
            double score,
            int focusTodaySeconds,
            int runningCount,
            String title,
            int elapsedSeconds,
            long updatedAtMs,
            String message
    ) {
        this.username = username;
        this.score = score;
        this.focusTodaySeconds = focusTodaySeconds;
        this.runningCount = runningCount;
        this.title = title;
        this.elapsedSeconds = elapsedSeconds;
        this.updatedAtMs = updatedAtMs;
        this.message = message;
    }

    static WidgetSnapshot needsKey() {
        return new WidgetSnapshot("infinWORK", 0, 0, 0, "Add your widget key", 0, 0, null);
    }

    static WidgetSnapshot message(String message) {
        return new WidgetSnapshot("infinWORK", 0, 0, 0, message, 0, 0, message);
    }

    boolean isRunning() {
        return runningCount > 0 && updatedAtMs > 0;
    }

    boolean hasLiveData() {
        return updatedAtMs > 0;
    }

    WidgetSnapshot withStatus(String status) {
        return new WidgetSnapshot(username, score, focusTodaySeconds, runningCount, title, elapsedSeconds, updatedAtMs, status);
    }

    static WidgetSnapshot parse(String json) {
        try {
            JSONObject object = new JSONObject(json);
            String title = "Idle";
            int elapsed = 0;
            JSONArray running = object.optJSONArray("running");
            int count = object.optInt("runningCount", running == null ? 0 : running.length());
            if (running != null && running.length() > 0) {
                JSONObject task = running.getJSONObject(0);
                title = task.optString("title", "Running task");
                elapsed = task.optInt("elapsedSeconds", 0);
                if (count > 1) {
                    title = title + "  +" + (count - 1);
                }
            } else if (count == 0) {
                title = "Idle";
            }
            return new WidgetSnapshot(
                    object.optString("username", "infinWORK"),
                    object.optDouble("score", 0),
                    object.optInt("focusTodaySeconds", 0),
                    count,
                    title,
                    elapsed,
                    object.optLong("updatedAtMs", 0),
                    null
            );
        } catch (Exception error) {
            return message("Couldn't read the widget");
        }
    }
}
