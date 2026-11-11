package app.infinwork.mobile.widget;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import app.infinwork.mobile.R;

public class WidgetConfigActivity extends AppCompatActivity {
    private int appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.widget_config);
        setResult(Activity.RESULT_CANCELED);

        appWidgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }

        EditText tokenInput = findViewById(R.id.widget_config_token);
        EditText baseInput = findViewById(R.id.widget_config_base);
        TextView status = findViewById(R.id.widget_config_status);
        Button save = findViewById(R.id.widget_config_save);
        tokenInput.setText(WidgetStore.token(this));
        baseInput.setText(WidgetStore.baseUrl(this));

        save.setOnClickListener(view -> {
            String token = tokenInput.getText() == null ? "" : tokenInput.getText().toString().trim();
            String base = baseInput.getText() == null ? "" : baseInput.getText().toString();
            if (!token.startsWith("inw_") || token.length() < 20) {
                status.setText("Paste the key from infinWORK Settings.");
                return;
            }
            save.setEnabled(false);
            status.setText("Connecting…");
            WidgetStore.saveConnection(this, token, base);
            Context appContext = getApplicationContext();
            new Thread(() -> {
                boolean connected = WidgetUpdater.refresh(appContext, new int[]{appWidgetId});
                runOnUiThread(() -> {
                    if (!connected) {
                        save.setEnabled(true);
                        status.setText("That key did not connect. Create it in infinWORK Settings and paste it again.");
                        return;
                    }
                    WidgetRefreshWorker.schedule(this);
                    Intent result = new Intent();
                    result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
                    setResult(Activity.RESULT_OK, result);
                    finish();
                });
            }).start();
        });
    }
}
