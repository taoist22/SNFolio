package com.sncalendar;

import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.text.TextUtils;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.os.Environment;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableNativeArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableNativeMap;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Writes plain-text files to device storage.
 *
 * The plugin SDK has no writeFile: FileUtils.exists() works but listFiles()
 * and any write are absent, so exporting a note as Markdown or text is not
 * possible through sn-plugin-lib. This is the minimum native surface needed —
 * a single text write — rather than pulling in react-native-fs, which has no
 * precedent in this workspace.
 */
public class CalendarFileModule extends ReactContextBaseJavaModule {

    private static final String SECRET_ALIAS = "sn_calendar_secrets_v1";
    private static final String SECRET_PREFS = "sn_calendar_encrypted";

    CalendarFileModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return "CalendarFile";
    }

    /**
     * Returns user-storage volume roots without depending on a current
     * Activity. SDK volume discovery uses getCurrentActivity(), which can be
     * detached while the plugin panel is transitioning and can close it.
     */
    @ReactMethod
    public void getStorageRoots(Promise promise) {
        try {
            LinkedHashSet<String> roots = new LinkedHashSet<>();
            File primary = Environment.getExternalStorageDirectory();
            if (primary != null) roots.add(primary.getAbsolutePath());

            File[] appDirs = getReactApplicationContext().getExternalFilesDirs(null);
            if (appDirs != null) {
                for (File appDir : appDirs) {
                    if (appDir == null) continue;
                    String path = appDir.getAbsolutePath();
                    int androidSegment = path.indexOf("/Android/");
                    if (androidSegment > 0) roots.add(path.substring(0, androidSegment));
                }
            }

            WritableArray result = new WritableNativeArray();
            for (String root : roots) result.pushString(root);
            promise.resolve(result);
        } catch (Throwable error) {
            promise.reject("E_STORAGE_ROOTS", error.getMessage(), error);
        }
    }

    private SecretKey getOrCreateSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(SECRET_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(SECRET_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                SECRET_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    /** Stores subscription URLs encrypted at rest rather than in shared AsyncStorage. */
    @ReactMethod
    public void setSecret(String key, String value, Promise promise) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey());
            byte[] encrypted = cipher.doFinal((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
            String packed = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
                    Base64.encodeToString(encrypted, Base64.NO_WRAP);
            getReactApplicationContext()
                    .getSharedPreferences(SECRET_PREFS, Context.MODE_PRIVATE)
                    .edit().putString(key, packed).apply();
            promise.resolve(true);
        } catch (Throwable error) {
            promise.reject("E_SECRET_WRITE", error.getMessage(), error);
        }
    }

    @ReactMethod
    public void getSecret(String key, Promise promise) {
        try {
            SharedPreferences prefs = getReactApplicationContext()
                    .getSharedPreferences(SECRET_PREFS, Context.MODE_PRIVATE);
            String packed = prefs.getString(key, null);
            if (packed == null) {
                promise.resolve(null);
                return;
            }
            String[] parts = packed.split(":", 2);
            if (parts.length != 2) throw new IllegalStateException("Invalid encrypted value");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(),
                    new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            byte[] clear = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
            promise.resolve(new String(clear, StandardCharsets.UTF_8));
        } catch (Throwable error) {
            promise.reject("E_SECRET_READ", error.getMessage(), error);
        }
    }

    /**
     * Reads a UTF-8 text file selected by Android. The Supernote picker may
     * return an absolute path, file:// URI, or content:// URI; React Native's
     * fetch(file://...) does not reliably support those forms.
     */
    @ReactMethod
    public void readTextFile(String pathOrUri, Promise promise) {
        if (TextUtils.isEmpty(pathOrUri)) {
            promise.reject("E_PATH", "No path given");
            return;
        }
        InputStream input = null;
        try {
            if (pathOrUri.startsWith("content://")) {
                input = getReactApplicationContext().getContentResolver().openInputStream(Uri.parse(pathOrUri));
            } else {
                String path = pathOrUri.startsWith("file://")
                        ? Uri.parse(pathOrUri).getPath()
                        : pathOrUri;
                input = new FileInputStream(new File(path));
            }
            if (input == null) throw new IllegalStateException("Could not open selected file");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) bytes.write(buffer, 0, read);
            promise.resolve(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        } catch (Throwable error) {
            promise.reject("E_READ", error.getMessage(), error);
        } finally {
            if (input != null) {
                try { input.close(); } catch (Throwable ignored) {}
            }
        }
    }

    @ReactMethod
    public void readBackupFile(String pathOrUri, Promise promise) {
        if (TextUtils.isEmpty(pathOrUri)) {
            promise.reject("E_PATH", "No path given");
            return;
        }
        InputStream input = null;
        try {
            if (pathOrUri.startsWith("content://")) {
                input = getReactApplicationContext().getContentResolver().openInputStream(Uri.parse(pathOrUri));
            } else {
                String path = pathOrUri.startsWith("file://")
                        ? Uri.parse(pathOrUri).getPath()
                        : pathOrUri;
                input = new FileInputStream(new File(path));
            }
            if (input == null) throw new IllegalStateException("Could not open selected file");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (bytes.size() + read > 32 * 1024 * 1024) throw new IllegalStateException("Backup exceeds 32 MB");
                bytes.write(buffer, 0, read);
            }
            promise.resolve(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        } catch (Throwable error) {
            promise.reject("E_READ", error.getMessage(), error);
        } finally {
            if (input != null) {
                try { input.close(); } catch (Throwable ignored) {}
            }
        }
    }

    /**
     * Copies imported calendar text into app-owned storage. Picker grants can
     * expire after the selection activity closes, so retaining only the
     * external path makes a calendar disappear on the next refresh/restart.
     */
    @ReactMethod
    public void storeImportedCalendar(String fileName, String content, Promise promise) {
        try {
            String safeName = TextUtils.isEmpty(fileName) ? "calendar.ics" : fileName;
            safeName = safeName.replaceAll("[^A-Za-z0-9._-]", "_");
            if (!safeName.toLowerCase().endsWith(".ics")) safeName += ".ics";
            File folder = new File(getReactApplicationContext().getFilesDir(), "sn-calendar/imports");
            if (!folder.exists() && !folder.mkdirs()) {
                promise.reject("E_MKDIR", "Could not create imported-calendar folder");
                return;
            }
            File target = new File(folder, System.currentTimeMillis() + "-" + safeName);
            FileOutputStream output = new FileOutputStream(target, false);
            try {
                output.write((content == null ? "" : content).getBytes(StandardCharsets.UTF_8));
                output.flush();
            } finally {
                output.close();
            }
            promise.resolve(target.getAbsolutePath());
        } catch (Throwable error) {
            promise.reject("E_IMPORT_STORE", error.getMessage(), error);
        }
    }

    /**
     * Opens a .note in the editor, optionally at a specific page.
     *
     * FileUtils.openFilePath() cannot do this — it builds a file-manager
     * intent and leaves the target in only_open_file, so it navigates to the
     * containing folder and stops. Launching the note activity directly is the
     * working route, proven in sn-lastnote on these devices.
     *
     * ACTION_VIEW is required: without it a running editor instance is reused
     * and the file_path extra is silently ignored, so you get whichever note
     * was open before. The extra key must be exactly "file_path", and "page"
     * is a 1-based int that is omitted to mean "last-used page".
     */
    @ReactMethod
    public void openNote(String filePath, int page, Promise promise) {
        if (TextUtils.isEmpty(filePath)) {
            promise.reject("E_PATH", "No path given");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setComponent(new ComponentName(
                    "com.ratta.supernote.note",
                    "com.ratta.supernote.note.view.NoteInsidePagesActivity"));
            intent.putExtra("file_path", filePath);
            if (page > 0) {
                intent.putExtra("page", page);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getReactApplicationContext().startActivity(intent);
            promise.resolve(true);
        } catch (Throwable error) {
            promise.reject("E_OPEN", error.getMessage(), error);
        }
    }

    /**
     * Opens a supported document in Supernote's native document reader.
     *
     * The SDK's FileUtils.openFilePath() targets FileManagerMainActivity and
     * therefore only reveals the containing folder. The document reader uses
     * the same direct file_path contract as the note editor and is the proven
     * route used by the other document-aware Supernote plugins.
     */
    @ReactMethod
    public void openDocument(String filePath, Promise promise) {
        if (TextUtils.isEmpty(filePath)) {
            promise.reject("E_PATH", "No path given");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setComponent(new ComponentName(
                    "com.supernote.document",
                    "com.supernote.document.MainActivity"));
            intent.putExtra("file_path", filePath);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getReactApplicationContext().startActivity(intent);
            promise.resolve(true);
        } catch (Throwable error) {
            promise.reject("E_OPEN_DOCUMENT", error.getMessage(), error);
        }
    }

    /**
     * Lists the files immediately inside a Resource folder.
     *
     * The public plugin FileUtils does not expose a working listFiles call on
     * device. Keeping this native surface read-only and non-recursive lets the
     * PARA browser mirror one shelf folder without becoming a storage crawler.
     */
    @ReactMethod
    public void listNoteFiles(String folderPath, Promise promise) {
        if (TextUtils.isEmpty(folderPath)) {
            promise.reject("E_PATH", "No folder path given");
            return;
        }
        try {
            File folder = new File(folderPath);
            if (!folder.exists()) {
                promise.resolve(new WritableNativeArray());
                return;
            }
            if (!folder.isDirectory()) {
                promise.reject("E_NOT_DIRECTORY", "Path is not a folder: " + folderPath);
                return;
            }
            File[] children = folder.listFiles();
            if (children == null) {
                promise.reject("E_LIST", "Could not read folder: " + folderPath);
                return;
            }
            Arrays.sort(children, Comparator.comparing(File::getName, String.CASE_INSENSITIVE_ORDER));
            WritableArray notes = new WritableNativeArray();
            for (File child : children) {
                // Some firmware exposes a notebook as a package-like directory
                // even though the shelf presents it as one .note document.
                if ((child.isFile() || child.getName().toLowerCase().endsWith(".note"))
                        && !child.getName().startsWith(".")) {
                    notes.pushString(child.getAbsolutePath());
                }
            }
            promise.resolve(notes);
        } catch (Throwable error) {
            promise.reject("E_LIST", error.getMessage(), error);
        }
    }

    /**
     * Lists one folder level for SNFolio's own PARA browser. Ordinary folders
     * remain navigable, while Supernote .note packages are exposed as files so
     * tapping them opens the note editor rather than descending into internals.
     */
    @ReactMethod
    public void listFolderEntries(String folderPath, Promise promise) {
        if (TextUtils.isEmpty(folderPath)) {
            promise.reject("E_PATH", "No folder path given");
            return;
        }
        try {
            File folder = new File(folderPath);
            if (!folder.exists()) {
                promise.resolve(new WritableNativeArray());
                return;
            }
            if (!folder.isDirectory()) {
                promise.reject("E_NOT_DIRECTORY", "Path is not a folder: " + folderPath);
                return;
            }
            File[] children = folder.listFiles();
            if (children == null) {
                promise.reject("E_LIST", "Could not read folder: " + folderPath);
                return;
            }
            Arrays.sort(children, Comparator.comparing(File::getName, String.CASE_INSENSITIVE_ORDER));
            WritableArray entries = new WritableNativeArray();
            for (File child : children) {
                String name = child.getName();
                String lower = name.toLowerCase();
                if (name.startsWith(".") || lower.endsWith(".mark")) continue;

                WritableMap entry = new WritableNativeMap();
                entry.putString("name", name);
                entry.putString("path", child.getAbsolutePath());
                entry.putBoolean("isFolder", child.isDirectory() && !lower.endsWith(".note"));
                entries.pushMap(entry);
            }
            promise.resolve(entries);
        } catch (Throwable error) {
            promise.reject("E_LIST", error.getMessage(), error);
        }
    }

    /**
     * Renames one user folder without copying its contents. This is deliberately
     * same-volume only: a recursive copy/delete would be slow, interruptible,
     * and much harder to recover safely on an e-ink device.
     */
    @ReactMethod
    public void moveFolder(String sourcePath, String destinationPath, Promise promise) {
        if (TextUtils.isEmpty(sourcePath) || TextUtils.isEmpty(destinationPath)) {
            promise.reject("E_PATH", "Both source and destination folders are required");
            return;
        }
        try {
            File source = new File(sourcePath).getCanonicalFile();
            File destination = new File(destinationPath).getCanonicalFile();
            String sourceCanonical = source.getPath();
            String destinationCanonical = destination.getPath();

            if (!sourceCanonical.startsWith("/storage/") || !destinationCanonical.startsWith("/storage/")) {
                promise.reject("E_PATH", "Folders must be inside user storage");
                return;
            }
            LinkedHashSet<String> protectedRoots = new LinkedHashSet<>();
            File primary = Environment.getExternalStorageDirectory();
            if (primary != null) protectedRoots.add(primary.getCanonicalPath());
            File[] appDirs = getReactApplicationContext().getExternalFilesDirs(null);
            if (appDirs != null) {
                for (File appDir : appDirs) {
                    if (appDir == null) continue;
                    String path = appDir.getCanonicalPath();
                    int androidSegment = path.indexOf("/Android/");
                    if (androidSegment > 0) protectedRoots.add(path.substring(0, androidSegment));
                }
            }
            for (String root : protectedRoots) {
                if (sourceCanonical.equals(root)
                        || (source.getParentFile() != null && source.getParentFile().getCanonicalPath().equals(root))) {
                    promise.reject("E_PROTECTED", "A storage root or top-level folder cannot be moved");
                    return;
                }
            }
            if (sourceCanonical.equals(destinationCanonical)
                    || destinationCanonical.startsWith(sourceCanonical + File.separator)) {
                promise.reject("E_PATH", "A folder cannot be moved into itself");
                return;
            }
            if (!source.exists()) {
                promise.reject("E_NOT_FOUND", "Source folder does not exist: " + sourceCanonical);
                return;
            }
            if (!source.isDirectory()) {
                promise.reject("E_NOT_DIRECTORY", "Source path is not a folder: " + sourceCanonical);
                return;
            }
            if (destination.exists()) {
                promise.reject("E_EXISTS", "Archive destination already exists: " + destinationCanonical);
                return;
            }
            File parent = destination.getParentFile();
            if (parent == null || (!parent.exists() && !parent.mkdirs())) {
                promise.reject("E_MKDIR", "Could not create archive folder: " + (parent == null ? "" : parent.getPath()));
                return;
            }
            if (!source.renameTo(destination)) {
                promise.reject("E_MOVE", "Folder move failed. Cross-storage moves are not supported.");
                return;
            }
            promise.resolve(destinationCanonical);
        } catch (Throwable error) {
            promise.reject("E_MOVE", error.getMessage(), error);
        }
    }

    /**
     * Writes UTF-8 text, creating parent directories as needed.
     * Resolves with the absolute path actually written so JS can report a
     * location the user can go and find, rather than one it assumed.
     */
    /** Finish a new backup before publishing its name; never overwrite an older snapshot. */
    @ReactMethod
    public void writeBackupFile(String path, String content, Promise promise) {
        File temporary = null;
        try {
            File target = new File(path).getCanonicalFile();
            if (!target.getPath().startsWith("/storage/") || !target.getName().endsWith(".snfolio.json")) {
                throw new IllegalArgumentException("Choose a backup path in user storage");
            }
            File parent = target.getParentFile();
            if (!parent.exists() && !parent.mkdirs()) throw new IllegalStateException("Could not create backup folder");
            if (target.exists()) throw new IllegalStateException("Backup already exists");
            temporary = File.createTempFile(".snfolio-", ".tmp", parent);
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(content.getBytes(StandardCharsets.UTF_8));
                output.flush();
                output.getFD().sync();
            }
            if (target.exists() || !temporary.renameTo(target)) throw new IllegalStateException("Could not finalize backup");
            promise.resolve(target.getAbsolutePath());
        } catch (Throwable error) {
            promise.reject("E_BACKUP_WRITE", error.getMessage(), error);
        } finally {
            if (temporary != null && temporary.exists()) temporary.delete();
        }
    }

    @ReactMethod
    public void writeTextFile(String path, String content, Promise promise) {
        if (path == null || path.length() == 0) {
            promise.reject("E_PATH", "No path given");
            return;
        }

        try {
            File file = new File(path);
            File parent = file.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                promise.reject("E_MKDIR", "Could not create folder: " + parent.getAbsolutePath());
                return;
            }

            FileOutputStream out = new FileOutputStream(file, false);
            OutputStreamWriter writer = new OutputStreamWriter(out, StandardCharsets.UTF_8);
            try {
                writer.write(content == null ? "" : content);
                writer.flush();
            } finally {
                writer.close();
                out.close();
            }

            promise.resolve(file.getAbsolutePath());
        } catch (Throwable error) {
            promise.reject("E_WRITE", error.getMessage(), error);
        }
    }
}
