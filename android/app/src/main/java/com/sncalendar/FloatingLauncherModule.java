package com.sncalendar;

import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;

/** A small non-focusable launcher, owned by this plugin's native module. */
public class FloatingLauncherModule extends ReactContextBaseJavaModule {
    private static View icon;
    private static WindowManager manager;
    public FloatingLauncherModule(ReactApplicationContext context) { super(context); }
    @Override public String getName() { return "FolioLauncher"; }
    private void remove() {
        if (icon != null && manager != null) { try { manager.removeView(icon); } catch (Exception ignored) {} }
        icon = null;
    }
    @ReactMethod public void hide(Promise promise) {
        UiThreadUtil.runOnUiThread(() -> { remove(); promise.resolve(true); });
    }
    @ReactMethod public void show(Promise promise) {
        UiThreadUtil.runOnUiThread(() -> {
            try {
                ReactApplicationContext ctx = getReactApplicationContext();
                if (!Settings.canDrawOverlays(ctx)) { promise.reject("OVERLAY_PERMISSION", "Floating-window permission is unavailable. Use the toolbar to open SNFolio."); return; }
                remove();
                manager = (WindowManager)ctx.getSystemService(android.content.Context.WINDOW_SERVICE);
                android.util.DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
                int size = Math.round(44 * dm.density);
                android.content.SharedPreferences saved = ctx.getSharedPreferences("snfolio_launcher", 0);
                WindowManager.LayoutParams params = new WindowManager.LayoutParams(size, size,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                    PixelFormat.TRANSLUCENT);
                params.gravity = Gravity.TOP | Gravity.LEFT;
                params.x = Math.max(0, Math.min(saved.getInt("x", dm.widthPixels-size), dm.widthPixels-size));
                params.y = Math.max(0, Math.min(saved.getInt("y", 100), dm.heightPixels-size));
                TextView button = new TextView(ctx);
                button.setText("SN"); button.setTextSize(16); button.setTextColor(Color.BLACK); button.setGravity(Gravity.CENTER);
                button.setContentDescription("SNFolio: tap to open or choose Recent Notes, hold for Quick Add, drag to move");
                GradientDrawable background = new GradientDrawable(); background.setColor(Color.WHITE); background.setStroke(3, Color.BLACK); background.setCornerRadius(size/4f); button.setBackground(background);
                button.setOnTouchListener(new View.OnTouchListener() {
                    float x, y; int left, top; long down; boolean moved;
                    public boolean onTouch(View view, MotionEvent event) {
                        switch(event.getActionMasked()) {
                            case MotionEvent.ACTION_DOWN:
                                x=event.getRawX(); y=event.getRawY(); left=params.x; top=params.y; down=event.getEventTime(); moved=false; return true;
                            case MotionEvent.ACTION_MOVE:
                                float dx=event.getRawX()-x, dy=event.getRawY()-y;
                                if (Math.abs(dx)>8*dm.density || Math.abs(dy)>8*dm.density) moved=true;
                                if (moved) {
                                    params.x=Math.max(0, Math.min(left+(int)dx, dm.widthPixels-size));
                                    params.y=Math.max(0, Math.min(top+(int)dy, dm.heightPixels-size));
                                    manager.updateViewLayout(view, params);
                                }
                                return true;
                            case MotionEvent.ACTION_UP:
                                saved.edit().putInt("x",params.x).putInt("y",params.y).apply();
                                if (!moved) ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("FolioLauncherTap", event.getEventTime()-down>=700 ? "quick" : "open");
                                return true;
                            case MotionEvent.ACTION_CANCEL: return true;
                            default: return false;
                        }
                    }
                });
                icon=button; manager.addView(button,params); promise.resolve(true);
            } catch(Exception error) { remove(); promise.reject("OVERLAY",error); }
        });
    }
    @Override public void invalidate() { UiThreadUtil.runOnUiThread(this::remove); super.invalidate(); }
}
