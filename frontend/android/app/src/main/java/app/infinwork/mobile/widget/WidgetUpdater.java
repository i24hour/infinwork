package app.infinwork.mobile.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import app.infinwork.mobile.MainActivity;
import app.infinwork.mobile.R;

final class WidgetUpdater {
    private WidgetUpdater() {}

    static void refreshAll(Context context) {
        int[] ids = AppWidgetManager.getInstance(context).getAppWidgetIds(
                new ComponentName(context, InfinworkWidgetProvider.class)
        );
        refresh(context, ids);
    }

    static boolean refresh(Context context, int[] ids) {
        if (ids == null || ids.length == 0) {
            return false;
        }
        Loaded loaded = load(context);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : ids) {
            manager.updateAppWidget(id, views(context, id, loaded.snapshot));
        }
        return loaded.ok;
    }

    private static final class Loaded {
        final WidgetSnapshot snapshot;
        final boolean ok;

        Loaded(WidgetSnapshot snapshot, boolean ok) {
            this.snapshot = snapshot;
            this.ok = ok;
        }
    }

    private static Loaded load(Context context) {
        String token = WidgetStore.token(context);
        if (token == null || token.isEmpty()) {
            return new Loaded(WidgetSnapshot.needsKey(), false);
        }

        HttpURLConnection connection = null;
        try {
            URL url = new URL(WidgetStore.baseUrl(context) + "/api/widget");
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + token);
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            String body = read(stream);
            if (status >= 200 && status < 300) {
                WidgetStore.saveSnapshot(context, body);
                WidgetSnapshot snapshot = WidgetSnapshot.parse(body);
                return new Loaded(snapshot, snapshot.hasLiveData());
            }
            String error = "Couldn't refresh";
            try {
                String message = new JSONObject(body).optString("error", "");
                if (!message.isEmpty()) {
                    error = message;
                }
            } catch (Exception ignored) {
                // Keep the short status.
            }
            return fallback(context, error);
        } catch (Exception error) {
            return fallback(context, "Couldn't refresh");
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static Loaded fallback(Context context, String message) {
        String cached = WidgetStore.lastSnapshot(context);
        if (cached == null || cached.isEmpty()) {
            return new Loaded(WidgetSnapshot.message(message), false);
        }
        WidgetSnapshot snapshot = WidgetSnapshot.parse(cached);
        if (!snapshot.hasLiveData()) {
            return new Loaded(WidgetSnapshot.message(message), false);
        }
        return new Loaded(snapshot.withStatus(message), true);
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }

    private static RemoteViews views(Context context, int appWidgetId, WidgetSnapshot snapshot) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_infinwork);
        String score = snapshot.hasLiveData()
                ? String.format(java.util.Locale.US, "%.2f", snapshot.score)
                : "—";
        views.setTextViewText(R.id.widget_score, score);
        views.setTextColor(R.id.widget_score, snapshot.score < 0 ? 0xFFFF6B6B : 0xFF4CAF50);
        views.setTextViewText(R.id.widget_title, snapshot.title);
        views.setTextViewText(R.id.widget_focus, focusLabel(snapshot.focusTodaySeconds));

        if (snapshot.isRunning()) {
            long elapsedMs = snapshot.elapsedSeconds * 1000L;
            elapsedMs += Math.max(0, System.currentTimeMillis() - snapshot.updatedAtMs);
            views.setChronometer(R.id.widget_timer, SystemClock.elapsedRealtime() - elapsedMs, null, true);
            views.setViewVisibility(R.id.widget_timer, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.widget_timer, View.GONE);
        }

        String status = snapshot.message == null ? "" : snapshot.message;
        views.setTextViewText(R.id.widget_status, status);
        views.setViewVisibility(R.id.widget_status, status.isEmpty() ? View.GONE : View.VISIBLE);

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(
                context,
                appWidgetId,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        ));

        Intent refresh = new Intent(context, InfinworkWidgetProvider.class);
        refresh.setAction(InfinworkWidgetProvider.ACTION_REFRESH);
        refresh.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        views.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(
                context,
                10_000 + appWidgetId,
                refresh,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        ));
        return views;
    }

    private static String focusLabel(int seconds) {
        int hours = Math.max(0, seconds) / 3600;
        int minutes = (Math.max(0, seconds) % 3600) / 60;
        return "Today " + hours + "h " + minutes + "m";
    }
}
