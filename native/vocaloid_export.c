#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <windows.h>
#include <stdio.h>
#include <stdint.h>
#include <wchar.h>

#define COMMAND_EXPORT_WAVE 33299
#define COMMAND_EXIT 57665
#define COMMAND_TRACK_EDITOR 65281
#define POLL_MS 20

typedef struct WindowSearch {
    DWORD process_id;
    HWND main_window;
    HWND mixer_window;
    HWND export_options_dialog;
    HWND save_dialog;
    HWND singer_warning_dialog;
    HWND event_verification_dialog;
    HWND any_dialog;
    wchar_t any_dialog_title[256];
} WindowSearch;

typedef struct ChildSearch {
    HWND filename_edit;
    HWND save_button;
} ChildSearch;

typedef struct DialogTextSearch {
    const wchar_t *needle;
    int matched;
} DialogTextSearch;

static HWINEVENTHOOK g_event_hook = NULL;
static const wchar_t *g_cancel_path = NULL;
static wchar_t g_filename_confirmation_path[32768] = {0};
static wchar_t g_filename_window_path[32768] = {0};
static int g_event_verification_seen = 0;
static int g_pre_send_adjusted = 0;

static int cancel_requested(void) {
    DWORD attributes;
    if (!g_cancel_path || g_cancel_path[0] == L'\0') return 0;
    attributes = GetFileAttributesW(g_cancel_path);
    return attributes != INVALID_FILE_ATTRIBUTES &&
           !(attributes & FILE_ATTRIBUTE_DIRECTORY);
}

static int filename_confirmed(void) {
    DWORD attributes;
    if (g_filename_confirmation_path[0] == L'\0') return 0;
    attributes = GetFileAttributesW(g_filename_confirmation_path);
    return attributes != INVALID_FILE_ATTRIBUTES &&
           !(attributes & FILE_ATTRIBUTE_DIRECTORY);
}

static const wchar_t *path_basename(const wchar_t *path) {
    const wchar_t *cursor;
    const wchar_t *filename;
    if (!path) return NULL;
    filename = path;
    for (cursor = path; *cursor != L'\0'; cursor++) {
        if (*cursor == L'\\' || *cursor == L'/') filename = cursor + 1;
    }
    return filename;
}

static int publish_filename_window(HWND filename_edit) {
    HANDLE file;
    char text[64];
    DWORD written = 0;
    int length;
    if (!filename_edit || g_filename_window_path[0] == L'\0') return 0;
    length = _snprintf(text, sizeof(text), "%llu\n",
                       (unsigned long long)(uintptr_t)filename_edit);
    if (length <= 0 || length >= (int)sizeof(text)) return 0;
    file = CreateFileW(g_filename_window_path, GENERIC_WRITE, FILE_SHARE_READ,
                       NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    if (!WriteFile(file, text, (DWORD)length, &written, NULL) ||
        written != (DWORD)length) {
        CloseHandle(file);
        return 0;
    }
    FlushFileBuffers(file);
    CloseHandle(file);
    return 1;
}

static void pump_window_events(void) {
    MSG message;
    while (PeekMessageW(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
}

static void CALLBACK hide_dialog_event(
    HWINEVENTHOOK hook,
    DWORD event,
    HWND window,
    LONG object_id,
    LONG child_id,
    DWORD event_thread,
    DWORD event_time
) {
    wchar_t class_name[64] = {0};
    (void)hook;
    (void)event;
    (void)child_id;
    (void)event_thread;
    (void)event_time;
    if (!window || object_id != OBJID_WINDOW) return;
    GetClassNameW(window, class_name, 64);
    if (wcscmp(class_name, L"#32770") == 0) {
        SetWindowPos(window, NULL, -32000, -32000, 0, 0,
                     SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
}

static BOOL enumerate_top_windows(
    HDESK desktop,
    WNDENUMPROC callback,
    LPARAM parameter
) {
    if (desktop) return EnumDesktopWindows(desktop, callback, parameter);
    return EnumWindows(callback, parameter);
}

static BOOL CALLBACK find_top_window(HWND window, LPARAM parameter) {
    WindowSearch *search = (WindowSearch *)parameter;
    DWORD process_id = 0;
    wchar_t class_name[128] = {0};
    wchar_t title[256] = {0};

    GetWindowThreadProcessId(window, &process_id);
    if (process_id != search->process_id) return TRUE;

    GetClassNameW(window, class_name, 128);
    GetWindowTextW(window, title, 256);
    if (wcscmp(class_name, L"#32770") == 0) {
        SetWindowPos(window, NULL, -32000, -32000, 0, 0,
                     SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        if (wcscmp(title, L"VOCALOID MIXER") == 0) {
            /* VOCALOID3 implements its modeless mixer as a #32770 top-level
               window.  It is not a modal error dialog and must not replace
               the Musical Editor as the WM_COMMAND target. */
            search->mixer_window = window;
        } else {
            search->any_dialog = window;
            wcsncpy(search->any_dialog_title, title, 255);
            search->any_dialog_title[255] = L'\0';
        }
        if (wcscmp(title, L"Export Wave File") == 0)
            search->export_options_dialog = window;
        else if (wcsstr(title, L"Export to Wave File") != NULL)
            search->save_dialog = window;
        else if (wcscmp(title, L"VOCALOID3 Editor") == 0)
            search->singer_warning_dialog = window;
        else if (wcscmp(title, L"Event Verification") == 0)
            search->event_verification_dialog = window;
    }
    if (GetMenu(window) != NULL) {
        if (wcscmp(title, L"VOCALOID MIXER") == 0) {
            search->mixer_window = window;
        } else {
            search->main_window = window;
        }
    }
    return TRUE;
}

static BOOL CALLBACK find_dialog_child(HWND window, LPARAM parameter) {
    ChildSearch *search = (ChildSearch *)parameter;
    wchar_t class_name[64] = {0};
    int control_id = GetDlgCtrlID(window);
    GetClassNameW(window, class_name, 64);
    if (control_id == 1001 && wcscmp(class_name, L"Edit") == 0) {
        search->filename_edit = window;
    } else if (control_id == IDOK && wcscmp(class_name, L"Button") == 0) {
        search->save_button = window;
    }
    return TRUE;
}

static BOOL CALLBACK find_dialog_text(HWND window, LPARAM parameter) {
    DialogTextSearch *search = (DialogTextSearch *)parameter;
    wchar_t title[1024] = {0};
    GetWindowTextW(window, title, 1024);
    if (wcsstr(title, search->needle) != NULL) {
        search->matched = 1;
        return FALSE;
    }
    return TRUE;
}

static int dialog_contains_text(HWND dialog, const wchar_t *needle) {
    DialogTextSearch text_search;
    if (!dialog || !IsWindow(dialog)) return 0;
    text_search.needle = needle;
    text_search.matched = 0;
    EnumChildWindows(dialog, find_dialog_text, (LPARAM)&text_search);
    return text_search.matched;
}

static int is_known_singer_warning(WindowSearch *search) {
    return dialog_contains_text(search->singer_warning_dialog,
                                L"Some singers in the file have been changed to the default singer");
}

static BOOL CALLBACK dump_dialog_child(HWND window, LPARAM parameter) {
    wchar_t class_name[64] = {0};
    wchar_t title[256] = {0};
    (void)parameter;
    GetClassNameW(window, class_name, 64);
    GetWindowTextW(window, title, 256);
    fwprintf(stderr, L"dialog child id=%d class=%ls title=%ls\n",
             GetDlgCtrlID(window), class_name, title);
    return TRUE;
}

static int process_exited(HANDLE process) {
    return WaitForSingleObject(process, 0) == WAIT_OBJECT_0;
}

static int quote_argument(const wchar_t *argument, wchar_t *output, size_t capacity) {
    size_t length = wcslen(argument);
    if (wcschr(argument, L'"') != NULL || length + 3 > capacity) return 0;
    output[0] = L'"';
    memcpy(output + 1, argument, length * sizeof(wchar_t));
    output[length + 1] = L'"';
    output[length + 2] = L'\0';
    return 1;
}

static int directory_from_path(const wchar_t *path, wchar_t *output, size_t capacity) {
    const wchar_t *slash;
    size_t length;
    if (wcslen(path) + 1 > capacity) return 0;
    wcscpy(output, path);
    slash = wcsrchr(output, L'\\');
    if (!slash) slash = wcsrchr(output, L'/');
    if (!slash) return 0;
    length = (size_t)(slash - output);
    if (length == 0) return 0;
    output[length] = L'\0';
    return 1;
}

static int wait_for_main_window(
    HDESK desktop,
    WindowSearch *search,
    HANDLE process,
    DWORD deadline
) {
    while (GetTickCount() < deadline) {
        if (cancel_requested()) return 0;
        search->main_window = NULL;
        search->mixer_window = NULL;
        pump_window_events();
        enumerate_top_windows(desktop, find_top_window, (LPARAM)search);
        if (search->main_window) return 1;
        if (search->mixer_window) {
            search->main_window = search->mixer_window;
            return 1;
        }
        if (process_exited(process)) return 0;
        Sleep(POLL_MS);
    }
    return 0;
}

static int wait_for_musical_editor_window(
    HDESK desktop,
    WindowSearch *search,
    HANDLE process,
    DWORD deadline
) {
    while (GetTickCount() < deadline) {
        if (cancel_requested()) return 0;
        search->main_window = NULL;
        search->mixer_window = NULL;
        pump_window_events();
        enumerate_top_windows(desktop, find_top_window, (LPARAM)search);
        if (search->main_window) return 1;
        if (process_exited(process)) return 0;
        Sleep(POLL_MS);
    }
    return 0;
}

static int wait_for_first_export_dialog(
    HDESK desktop,
    WindowSearch *search,
    HANDLE process,
    DWORD deadline,
    int allow_pre_send_adjustment
) {
    while (GetTickCount() < deadline) {
        if (cancel_requested()) return 0;
        search->export_options_dialog = NULL;
        search->save_dialog = NULL;
        search->singer_warning_dialog = NULL;
        search->event_verification_dialog = NULL;
        search->any_dialog = NULL;
        search->any_dialog_title[0] = L'\0';
        pump_window_events();
        enumerate_top_windows(desktop, find_top_window, (LPARAM)search);
        if (search->export_options_dialog || search->save_dialog) return 1;
        if (is_known_singer_warning(search)) return -1;
        if (search->event_verification_dialog) {
            g_event_verification_seen = 1;
            if (!allow_pre_send_adjustment) return -2;
            {
                HWND yes_button = GetDlgItem(search->event_verification_dialog, IDYES);
                if (!yes_button) return -3;
                SendMessageW(search->event_verification_dialog, WM_COMMAND,
                             MAKEWPARAM(IDYES, BN_CLICKED), (LPARAM)yes_button);
                g_pre_send_adjusted = 1;
            }
            Sleep(POLL_MS);
            continue;
        }
        if (process_exited(process)) return 0;
        Sleep(5);
    }
    return 0;
}

static int wait_for_save_dialog(
    HDESK desktop,
    WindowSearch *search,
    HANDLE process,
    DWORD deadline
) {
    while (GetTickCount() < deadline) {
        if (cancel_requested()) return 0;
        search->save_dialog = NULL;
        pump_window_events();
        enumerate_top_windows(desktop, find_top_window, (LPARAM)search);
        if (search->save_dialog) return 1;
        if (process_exited(process)) return 0;
        Sleep(5);
    }
    return 0;
}

static int wait_for_save_controls(
    HWND dialog,
    HANDLE process,
    DWORD deadline,
    ChildSearch *children
) {
    while (GetTickCount() < deadline) {
        if (cancel_requested()) return 0;
        ZeroMemory(children, sizeof(*children));
        EnumChildWindows(dialog, find_dialog_child, (LPARAM)children);
        if (children->filename_edit && children->save_button) return 1;
        if (process_exited(process) || !IsWindow(dialog)) return 0;
        pump_window_events();
        Sleep(POLL_MS);
    }
    return 0;
}

static int set_save_filename(
    HWND dialog,
    HWND filename_edit,
    HWND save_button,
    HANDLE process,
    DWORD deadline,
    const wchar_t *output
) {
    wchar_t observed[32768] = {0};
    wchar_t parent_class[64] = {0};
    int control_id;
    HWND parent;
    DWORD current_thread;
    DWORD dialog_thread;
    DWORD foreground_thread = 0;
    DWORD input_deadline;
    int attached = 0;
    int foreground_attached = 0;
    UINT keyboard_events = 0;
    HWND previous_foreground;

    if (!dialog || !filename_edit || !output || output[0] == L'\0') return 0;
    control_id = GetDlgCtrlID(filename_edit);
    if (control_id <= 0) return 0;
    parent = GetParent(filename_edit);
    if (parent) GetClassNameW(parent, parent_class, 64);
    current_thread = GetCurrentThreadId();
    dialog_thread = GetWindowThreadProcessId(dialog, NULL);
    previous_foreground = GetForegroundWindow();
    if (previous_foreground) {
        foreground_thread = GetWindowThreadProcessId(previous_foreground, NULL);
    }
    if (dialog_thread && dialog_thread != current_thread) {
        attached = AttachThreadInput(current_thread, dialog_thread, TRUE);
    }
    if (foreground_thread && foreground_thread != current_thread &&
        foreground_thread != dialog_thread) {
        foreground_attached = AttachThreadInput(current_thread,
                                                 foreground_thread, TRUE);
    }
    input_deadline = GetTickCount() + 15000;
    if (input_deadline > deadline) input_deadline = deadline;
    if (!publish_filename_window(filename_edit)) {
        if (foreground_attached) {
            AttachThreadInput(current_thread, foreground_thread, FALSE);
        }
        if (attached) AttachThreadInput(current_thread, dialog_thread, FALSE);
        return 0;
    }

    /* The legacy Explorer-style common dialog keeps filename state outside
       the child Edit control.  Use exactly one physical-keyboard-style input
       sequence.  Mixing WM_CHAR/WM_SETTEXT with SendInput creates a race in
       which accessibility can briefly observe the first complete value before
       a failed Ctrl+A appends the second copy. */
    while (GetTickCount() < input_deadline) {
        const wchar_t *character;
        if (cancel_requested() || process_exited(process) ||
            !IsWindow(dialog) || !IsWindow(filename_edit)) break;
        pump_window_events();
        if (!IsWindowEnabled(filename_edit) || !IsWindowEnabled(save_button)) {
            Sleep(50);
            continue;
        }
        SetWindowPos(dialog, HWND_TOPMOST, -32000, -32000, 0, 0,
                     SWP_NOSIZE | SWP_SHOWWINDOW);
        BringWindowToTop(dialog);
        SetForegroundWindow(dialog);
        SetActiveWindow(dialog);
        SetFocus(filename_edit);
        SetWindowPos(dialog, HWND_NOTOPMOST, -32000, -32000, 0, 0,
                     SWP_NOSIZE | SWP_SHOWWINDOW);
        if (keyboard_events == 0 && GetFocus() == filename_edit &&
            GetForegroundWindow() == dialog) {
            INPUT select_all[4];
            ZeroMemory(select_all, sizeof(select_all));
            select_all[0].type = INPUT_KEYBOARD;
            select_all[0].ki.wVk = VK_CONTROL;
            select_all[1].type = INPUT_KEYBOARD;
            select_all[1].ki.wVk = 'A';
            select_all[2] = select_all[1];
            select_all[2].ki.dwFlags = KEYEVENTF_KEYUP;
            select_all[3] = select_all[0];
            select_all[3].ki.dwFlags = KEYEVENTF_KEYUP;
            keyboard_events += SendInput(4, select_all, sizeof(INPUT));
            for (character = output; *character != L'\0'; character++) {
                INPUT unicode_input[2];
                ZeroMemory(unicode_input, sizeof(unicode_input));
                unicode_input[0].type = INPUT_KEYBOARD;
                unicode_input[0].ki.wScan = *character;
                unicode_input[0].ki.dwFlags = KEYEVENTF_UNICODE;
                unicode_input[1] = unicode_input[0];
                unicode_input[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
                keyboard_events += SendInput(2, unicode_input, sizeof(INPUT));
            }
        }
        Sleep(100);
        if (filename_confirmed()) {
            if (previous_foreground && IsWindow(previous_foreground)) {
                SetForegroundWindow(previous_foreground);
            }
            if (foreground_attached) {
                AttachThreadInput(current_thread, foreground_thread, FALSE);
            }
            if (attached) AttachThreadInput(current_thread, dialog_thread, FALSE);
            return 1;
        }
        observed[0] = L'\0';
        GetWindowTextW(filename_edit, observed, 32768);
    }
    {
        DWORD edit_process = 0;
        DWORD dialog_process = 0;
        wchar_t edit_class[64] = {0};
        GetWindowThreadProcessId(filename_edit, &edit_process);
        GetWindowThreadProcessId(dialog, &dialog_process);
        GetClassNameW(filename_edit, edit_class, 64);
        fwprintf(stderr,
                 L"filename input diagnostics: edit_class=%ls parent_class=%ls "
                 L"edit_pid=%lu dialog_pid=%lu enabled=%d visible=%d "
                 L"style=0x%llx focus=%p edit=%p foreground=%p "
                 L"sendinput_events=%u observed_length=%u\n",
                 edit_class, parent_class,
                 (unsigned long)edit_process, (unsigned long)dialog_process,
                 IsWindowEnabled(filename_edit), IsWindowVisible(filename_edit),
                 (unsigned long long)(uintptr_t)GetWindowLongPtrW(filename_edit, GWL_STYLE),
                 (void *)GetFocus(), (void *)filename_edit,
                 (void *)GetForegroundWindow(), keyboard_events,
                 (unsigned int)wcslen(observed));
    }
    if (previous_foreground && IsWindow(previous_foreground)) {
        SetForegroundWindow(previous_foreground);
    }
    if (foreground_attached) {
        AttachThreadInput(current_thread, foreground_thread, FALSE);
    }
    if (attached) AttachThreadInput(current_thread, dialog_thread, FALSE);
    return 0;
}

static int submit_save_dialog(
    HWND dialog,
    HWND save_button,
    HANDLE process,
    DWORD deadline
) {
    DWORD current_thread;
    DWORD dialog_thread;
    DWORD foreground_thread = 0;
    DWORD submission_deadline = GetTickCount() + 15000;
    DWORD keyboard_deadline;
    HWND foreground;
    int attached = 0;
    int foreground_attached = 0;
    int submitted = 0;
    INPUT enter_input[2];

    if (submission_deadline > deadline) submission_deadline = deadline;
    if (!dialog || !save_button || !IsWindow(dialog) ||
        !IsWindow(save_button)) return 0;

    current_thread = GetCurrentThreadId();
    dialog_thread = GetWindowThreadProcessId(dialog, NULL);
    foreground = GetForegroundWindow();
    if (foreground) {
        foreground_thread = GetWindowThreadProcessId(foreground, NULL);
    }
    if (dialog_thread && dialog_thread != current_thread) {
        attached = AttachThreadInput(current_thread, dialog_thread, TRUE);
    }
    if (foreground_thread && foreground_thread != current_thread &&
        foreground_thread != dialog_thread) {
        foreground_attached = AttachThreadInput(current_thread,
                                                 foreground_thread, TRUE);
    }

    SetWindowPos(dialog, HWND_TOPMOST, -32000, -32000, 0, 0,
                 SWP_NOSIZE | SWP_SHOWWINDOW);
    BringWindowToTop(dialog);
    SetForegroundWindow(dialog);
    SetActiveWindow(dialog);
    SetFocus(save_button);
    SetWindowPos(dialog, HWND_NOTOPMOST, -32000, -32000, 0, 0,
                 SWP_NOSIZE | SWP_SHOWWINDOW);

    /* Shell-backed common dialogs can ignore a cross-process BM_CLICK even
       when the filename field has accepted keyboard input.  Press Enter
       through the active default Save button first, just as an interactive
       user would. */
    ZeroMemory(enter_input, sizeof(enter_input));
    enter_input[0].type = INPUT_KEYBOARD;
    enter_input[0].ki.wVk = VK_RETURN;
    enter_input[1] = enter_input[0];
    enter_input[1].ki.dwFlags = KEYEVENTF_KEYUP;
    submitted = SendInput(2, enter_input, sizeof(INPUT)) == 2;

    keyboard_deadline = GetTickCount() + 1000;
    if (keyboard_deadline > submission_deadline) {
        keyboard_deadline = submission_deadline;
    }
    while (GetTickCount() < keyboard_deadline) {
        if (cancel_requested()) break;
        pump_window_events();
        if (!IsWindow(dialog)) {
            submitted = 1;
            break;
        }
        if (process_exited(process)) break;
        Sleep(POLL_MS);
    }

    if (IsWindow(dialog) && !cancel_requested() &&
        !process_exited(process)) {
        SendMessageW(dialog, WM_COMMAND,
                     MAKEWPARAM(IDOK, BN_CLICKED), (LPARAM)save_button);
        SendMessageW(save_button, BM_CLICK, 0, 0);
    }
    while (GetTickCount() < submission_deadline) {
        if (cancel_requested()) break;
        pump_window_events();
        if (!IsWindow(dialog)) {
            submitted = 1;
            break;
        }
        if (process_exited(process)) break;
        Sleep(POLL_MS);
    }

    if (foreground_attached) {
        AttachThreadInput(current_thread, foreground_thread, FALSE);
    }
    if (attached) AttachThreadInput(current_thread, dialog_thread, FALSE);
    return submitted && !IsWindow(dialog);
}

static int file_size(const wchar_t *path, uint64_t *size) {
    WIN32_FILE_ATTRIBUTE_DATA attributes;
    ULARGE_INTEGER value;
    if (!GetFileAttributesExW(path, GetFileExInfoStandard, &attributes)) return 0;
    if (attributes.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) return 0;
    value.HighPart = attributes.nFileSizeHigh;
    value.LowPart = attributes.nFileSizeLow;
    *size = value.QuadPart;
    return 1;
}

static int wait_for_stable_file(
    const wchar_t *path,
    HANDLE process,
    DWORD deadline,
    uint64_t *final_size
) {
    uint64_t previous = 0;
    uint64_t current = 0;
    int stable_count = 0;
    while (GetTickCount() < deadline) {
        if (cancel_requested()) return 0;
        if (file_size(path, &current) && current > 44) {
            if (current == previous) stable_count++;
            else stable_count = 0;
            previous = current;
            if (stable_count >= 4) {
                *final_size = current;
                return 1;
            }
        }
        if (process_exited(process)) return 0;
        Sleep(250);
    }
    return 0;
}

static void cancel_dialog(HWND dialog) {
    HWND cancel_button;
    if (!dialog || !IsWindow(dialog)) return;
    cancel_button = GetDlgItem(dialog, IDCANCEL);
    if (cancel_button) {
        PostMessageW(dialog, WM_COMMAND,
                     MAKEWPARAM(IDCANCEL, BN_CLICKED), (LPARAM)cancel_button);
    } else {
        PostMessageW(dialog, WM_CLOSE, 0, 0);
    }
}

static void stop_process(HANDLE process, WindowSearch *search, int *forced) {
    DWORD wait_result;
    if (process_exited(process)) return;

    /* Always unwind modal dialogs before asking the old MFC owner to exit.
       Closing the disabled owner while a common dialog is still initializing
       can crash VOCALOID3.exe during its UI teardown. */
    cancel_dialog(search->save_dialog);
    cancel_dialog(search->export_options_dialog);
    if (search->any_dialog != search->save_dialog &&
        search->any_dialog != search->export_options_dialog) {
        cancel_dialog(search->any_dialog);
    }
    for (int attempt = 0; attempt < 50 && search->main_window &&
         !IsWindowEnabled(search->main_window); attempt++) {
        pump_window_events();
        Sleep(POLL_MS);
    }
    if (search->main_window && !IsWindowEnabled(search->main_window)) {
        TerminateProcess(process, 1);
        WaitForSingleObject(process, 2000);
        *forced = 1;
        return;
    }
    if (search->main_window) {
        PostMessageW(search->main_window, WM_COMMAND, MAKEWPARAM(COMMAND_EXIT, 0), 0);
    }
    wait_result = WaitForSingleObject(process, 5000);
    if (wait_result == WAIT_OBJECT_0) return;
    if (search->main_window) PostMessageW(search->main_window, WM_CLOSE, 0, 0);
    wait_result = WaitForSingleObject(process, 3000);
    if (wait_result == WAIT_OBJECT_0) return;
    TerminateProcess(process, 1);
    WaitForSingleObject(process, 2000);
    *forced = 1;
}

static int fail(
    int code,
    const char *stage,
    DWORD win32_error,
    PROCESS_INFORMATION *process_info,
    WindowSearch *search,
    HDESK desktop
) {
    int forced = 0;
    int cancelled = cancel_requested();
    if (cancelled) stage = "cancelled";
    if (process_info && process_info->hProcess) {
        stop_process(process_info->hProcess, search, &forced);
        CloseHandle(process_info->hProcess);
        if (process_info->hThread) CloseHandle(process_info->hThread);
    }
    if (desktop) CloseDesktop(desktop);
    if (g_event_hook) {
        UnhookWinEvent(g_event_hook);
        g_event_hook = NULL;
    }
    fprintf(stderr, "vocaloid export failed at %s (win32=%lu)\n",
            stage, (unsigned long)win32_error);
    printf("{\"ok\":false,\"stage\":\"%s\",\"win32_error\":%lu,"
           "\"forced_termination\":%s,\"cancelled\":%s,"
           "\"event_verification_seen\":%s,\"pre_send_adjusted\":%s}\n",
           stage, (unsigned long)win32_error, forced ? "true" : "false",
           cancelled ? "true" : "false",
           g_event_verification_seen ? "true" : "false",
           g_pre_send_adjusted ? "true" : "false");
    return code;
}

int wmain(int argc, wchar_t **argv) {
    const wchar_t *executable;
    const wchar_t *project;
    const wchar_t *output;
    DWORD timeout_ms;
    DWORD start_tick;
    DWORD deadline;
    DWORD attributes;
    wchar_t quoted_executable[32768];
    wchar_t quoted_project[32768];
    wchar_t command_line[65536];
    wchar_t working_directory[32768];
    HDESK desktop = NULL;
    STARTUPINFOW startup;
    PROCESS_INFORMATION process_info;
    WindowSearch search;
    ChildSearch children;
    int export_dialog_result;
    int allow_pre_send_adjustment;
    uint64_t output_size = 0;
    int forced = 0;

    if (argc != 7) {
        fwprintf(stderr,
                 L"usage: vocaloid_export.exe <VOCALOID3.exe> <input.vsqx> "
                 L"<output.wav> <timeout-ms> <adjust-pre-send:0|1> "
                 L"<cancel-file>\n");
        return 64;
    }
    executable = argv[1];
    project = argv[2];
    output = argv[3];
    timeout_ms = wcstoul(argv[4], NULL, 10);
    allow_pre_send_adjustment = wcscmp(argv[5], L"1") == 0;
    g_cancel_path = argv[6];
    if (_snwprintf(g_filename_confirmation_path, 32768,
                   L"%ls.save-monitor-confirmed", g_cancel_path) < 0) {
        return fail(65, "build_confirmation_path", ERROR_INSUFFICIENT_BUFFER,
                    NULL, NULL, NULL);
    }
    if (_snwprintf(g_filename_window_path, 32768,
                   L"%ls.save-monitor-window", g_cancel_path) < 0) {
        return fail(65, "build_window_path", ERROR_INSUFFICIENT_BUFFER,
                    NULL, NULL, NULL);
    }
    DeleteFileW(g_filename_confirmation_path);
    DeleteFileW(g_filename_window_path);
    if (cancel_requested()) {
        return fail(66, "cancelled_before_launch", ERROR_CANCELLED,
                    NULL, NULL, NULL);
    }
    if (timeout_ms < 10000 || timeout_ms > 600000) {
        return fail(65, "validate_timeout", ERROR_INVALID_PARAMETER,
                    NULL, NULL, NULL);
    }
    attributes = GetFileAttributesW(executable);
    if (attributes == INVALID_FILE_ATTRIBUTES ||
        (attributes & FILE_ATTRIBUTE_DIRECTORY)) {
        return fail(65, "validate_executable", GetLastError(), NULL, NULL, NULL);
    }
    attributes = GetFileAttributesW(project);
    if (attributes == INVALID_FILE_ATTRIBUTES ||
        (attributes & FILE_ATTRIBUTE_DIRECTORY)) {
        return fail(65, "validate_project", GetLastError(), NULL, NULL, NULL);
    }
    if (GetFileAttributesW(output) != INVALID_FILE_ATTRIBUTES) {
        return fail(65, "refuse_existing_output", ERROR_FILE_EXISTS,
                    NULL, NULL, NULL);
    }
    if (!quote_argument(executable, quoted_executable, 32768) ||
        !quote_argument(project, quoted_project, 32768) ||
        !directory_from_path(executable, working_directory, 32768)) {
        return fail(65, "validate_paths", ERROR_INVALID_PARAMETER,
                    NULL, NULL, NULL);
    }
    if (_snwprintf(command_line, 65536, L"%ls %ls", quoted_executable,
                   quoted_project) < 0) {
        return fail(65, "build_command_line", ERROR_INSUFFICIENT_BUFFER,
                    NULL, NULL, NULL);
    }

    ZeroMemory(&startup, sizeof(startup));
    ZeroMemory(&process_info, sizeof(process_info));
    ZeroMemory(&search, sizeof(search));
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESHOWWINDOW;
    startup.wShowWindow = SW_SHOWMINIMIZED;
    if (!CreateProcessW(executable, command_line, NULL, NULL, FALSE,
                        CREATE_UNICODE_ENVIRONMENT, NULL, working_directory,
                        &startup, &process_info)) {
        return fail(67, "launch_editor", GetLastError(),
                    &process_info, &search, desktop);
    }
    search.process_id = process_info.dwProcessId;
    g_event_hook = SetWinEventHook(
        EVENT_OBJECT_SHOW,
        EVENT_OBJECT_SHOW,
        NULL,
        hide_dialog_event,
        process_info.dwProcessId,
        0,
        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
    );
    if (!g_event_hook) {
        return fail(68, "install_dialog_guard", GetLastError(),
                    &process_info, &search, desktop);
    }
    start_tick = GetTickCount();
    deadline = start_tick + timeout_ms;
    WaitForInputIdle(process_info.hProcess, 30000);
    if (!wait_for_main_window(desktop, &search, process_info.hProcess, deadline)) {
        return fail(69, "wait_for_editor", ERROR_TIMEOUT,
                    &process_info, &search, desktop);
    }

    ShowWindow(search.main_window, SW_SHOW);
    UpdateWindow(search.main_window);
    PostMessageW(search.main_window, WM_COMMAND,
                 MAKEWPARAM(COMMAND_TRACK_EDITOR, 0), 0);
    if (!wait_for_musical_editor_window(
            desktop, &search, process_info.hProcess, deadline)) {
        return fail(70, "wait_for_musical_editor", ERROR_TIMEOUT,
                    &process_info, &search, desktop);
    }

    if (!PostMessageW(search.main_window, WM_COMMAND,
                      MAKEWPARAM(COMMAND_EXPORT_WAVE, 0), 0)) {
        return fail(70, "open_export_dialog", GetLastError(),
                    &process_info, &search, desktop);
    }
    export_dialog_result = wait_for_first_export_dialog(
        desktop, &search, process_info.hProcess, deadline,
        allow_pre_send_adjustment);
    if (export_dialog_result < 0) {
        if (export_dialog_result == -3) {
            return fail(71, "find_event_verification_yes", ERROR_NOT_FOUND,
                        &process_info, &search, desktop);
        }
        if (export_dialog_result == -2) {
            fwprintf(stderr,
                     L"project requires manual Event Verification; refusing "
                     L"to change Editor Pre-Send settings\n");
            EnumChildWindows(search.event_verification_dialog,
                             dump_dialog_child, 0);
            return fail(71, "event_verification_required", ERROR_INVALID_DATA,
                        &process_info, &search, desktop);
        }
        fwprintf(stderr,
                 L"selected singer is unavailable to VOCALOID3 Editor\n");
        EnumChildWindows(search.singer_warning_dialog, dump_dialog_child, 0);
        return fail(71, "singer_unavailable", ERROR_NOT_FOUND,
                    &process_info, &search, desktop);
    }
    if (!export_dialog_result) {
        if (search.any_dialog) {
            fwprintf(stderr, L"unexpected VOCALOID dialog: %ls\n",
                     search.any_dialog_title);
            EnumChildWindows(search.any_dialog, dump_dialog_child, 0);
            /* A missing saved AudioOut device raises a "VOCALOID Editor" modal
               followed by Preferences; neither exposes readable text across
               processes, so the title is the only available evidence. */
            if (wcscmp(search.any_dialog_title, L"VOCALOID Editor") == 0 ||
                wcscmp(search.any_dialog_title, L"Preferences") == 0) {
                fwprintf(stderr,
                         L"hint: this usually means the Editor cannot find its "
                         L"saved audio output device; open the Editor, choose a "
                         L"present Audio Device in Preferences, and press OK\n");
            }
        }
        return fail(71, "wait_for_export_dialog", ERROR_TIMEOUT,
                    &process_info, &search, desktop);
    }

    if (search.export_options_dialog) {
        HWND master_track = GetDlgItem(search.export_options_dialog, 1407);
        HWND analysis_file = GetDlgItem(search.export_options_dialog, 1503);
        HWND ok_button = GetDlgItem(search.export_options_dialog, IDOK);
        if (!master_track || !analysis_file || !ok_button) {
            EnumChildWindows(search.export_options_dialog, dump_dialog_child, 0);
            return fail(72, "find_export_option_controls", ERROR_NOT_FOUND,
                        &process_info, &search, desktop);
        }
        SendMessageW(master_track, BM_CLICK, 0, 0);
        SendMessageW(analysis_file, BM_SETCHECK, BST_UNCHECKED, 0);
        SendMessageW(ok_button, BM_CLICK, 0, 0);
        if (!wait_for_save_dialog(desktop, &search, process_info.hProcess, deadline)) {
            return fail(73, "wait_for_save_dialog", ERROR_TIMEOUT,
                        &process_info, &search, desktop);
        }
    }

    if (!wait_for_save_controls(
            search.save_dialog,
            process_info.hProcess,
            deadline,
            &children)) {
        EnumChildWindows(search.save_dialog, dump_dialog_child, 0);
        return fail(74, "find_save_controls", ERROR_NOT_FOUND,
                    &process_info, &search, desktop);
    }
    if (!set_save_filename(search.save_dialog, children.filename_edit,
                           children.save_button, process_info.hProcess,
                           deadline, path_basename(output))) {
        EnumChildWindows(search.save_dialog, dump_dialog_child, 0);
        return fail(75, "set_save_filename", ERROR_INVALID_DATA,
                    &process_info, &search, desktop);
    }
    if (!submit_save_dialog(search.save_dialog, children.save_button,
                            process_info.hProcess, deadline)) {
        EnumChildWindows(search.save_dialog, dump_dialog_child, 0);
        return fail(75, "submit_save_dialog", ERROR_TIMEOUT,
                    &process_info, &search, desktop);
    }
    search.save_dialog = NULL;

    if (!wait_for_stable_file(output, process_info.hProcess, deadline, &output_size)) {
        return fail(75, "wait_for_wave", ERROR_TIMEOUT,
                    &process_info, &search, desktop);
    }

    stop_process(process_info.hProcess, &search, &forced);
    CloseHandle(process_info.hProcess);
    CloseHandle(process_info.hThread);
    if (desktop) CloseDesktop(desktop);
    if (g_event_hook) {
        UnhookWinEvent(g_event_hook);
        g_event_hook = NULL;
    }
    printf("{\"ok\":true,\"process_id\":%lu,\"bytes\":%llu,"
           "\"elapsed_ms\":%lu,\"forced_termination\":%s,"
           "\"event_verification_seen\":%s,\"pre_send_adjusted\":%s}\n",
           (unsigned long)process_info.dwProcessId,
           (unsigned long long)output_size,
           (unsigned long)(GetTickCount() - start_tick),
           forced ? "true" : "false",
           g_event_verification_seen ? "true" : "false",
           g_pre_send_adjusted ? "true" : "false");
    return 0;
}
