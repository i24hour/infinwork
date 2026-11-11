package app.infinwork.mobile.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

public class InfinworkWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_REFRESH = "app.infinwork.mobile.WIDGET_REFRESH";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        WidgetRefreshWorker.schedule(context);
        refresh(context, appWidgetIds);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager, int appWidgetId, Bundle newOptions) {
        refresh(context, new int[]{appWidgetId});
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent == null || !ACTION_REFRESH.equals(intent.getAction())) {
            return;
        }
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        int[] ids = id == AppWidgetManager.INVALID_APPWIDGET_ID
                ? AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, InfinworkWidgetProvider.class))
                : new int[]{id};
        refresh(context, ids);
    }

    @Override
    public void onEnabled(Context context) {
        WidgetRefreshWorker.schedule(context);
    }

    @Override
    public void onDisabled(Context context) {
        WidgetRefreshWorker.cancel(context);
    }

    private void refresh(Context context, int[] ids) {
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                WidgetUpdater.refresh(context, ids);
            } finally {
                pending.finish();
            }
        }).start();
    }
}
