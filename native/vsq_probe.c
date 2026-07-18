#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <tlhelp32.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>
#include <math.h>

#if !defined(__i386__)
#error This helper must be compiled for 32-bit x86.
#endif

/* GCC understands Microsoft's x86 thiscall convention for indirect calls. */
#define THISCALL __attribute__((thiscall))

typedef void *(THISCALL *CtorFn)(void *self);
typedef void (THISCALL *DtorFn)(void *self);
typedef int (THISCALL *SysInitializeFn)(void *self, const void *policy);
typedef void *(THISCALL *LoadVsqFn)(void *self, const wchar_t *path);
typedef unsigned int (THISCALL *GetLastErrorFn)(const void *self);
typedef const wchar_t *(THISCALL *GetLastErrorMsgFn)(const void *self);
typedef int (THISCALL *EnumerateChildrenFn)(void *self, void *out_vector);
typedef void *(__attribute__((stdcall)) *RawVectorCtorFn)(void *self);
typedef void *(THISCALL *WStringCtorFn)(void *self);
typedef void (THISCALL *WStringDtorFn)(void *self);
typedef void *(THISCALL *WStringAssignFn)(void *self, const wchar_t *value);
typedef void *(THISCALL *GetMasterTrackFn)(void *self);
typedef void *(__attribute__((cdecl)) *CreateTimeMapFn)(const void *master_track);
typedef void *(THISCALL *EncodePartFn)(void *self, const void *encode_options);
typedef int (THISCALL *OpenSynthFn)(void *self, const wchar_t *dse_path,
                                    double api_version);
typedef int (THISCALL *SetDbmPathFn)(void *self,
                                     const char *registry_key_format,
                                     const char *compatibility_path);
typedef int (__attribute__((cdecl)) *RegistryVoiceInitFn)(const char *subkey);
typedef int (THISCALL *DoSynthesisFn)(void *self, void *daisy_buffer,
                                      void *wave_file, unsigned int sample_rate,
                                      unsigned int progress_interval,
                                      int export_mode, const char *export_path,
                                      int export_format, float arg9, float arg10);
typedef int (THISCALL *CloseSynthFn)(void *self);
typedef void (THISCALL *FlushWaveFn)(void *self);
typedef unsigned int (THISCALL *GetWaveDataBytesFn)(void *self);
typedef unsigned int (THISCALL *GetWaveDataFn)(void *self, unsigned char *output,
                                               unsigned int output_bytes);
typedef void *(THISCALL *ObjectCtorNoArgsFn)(void *self);
typedef void *(THISCALL *WaveCtorFn)(void *self, unsigned int block_samples);

typedef struct RawPointerVector {
    void *proxy;
    void *reserved1;
    void *reserved2;
    void **begin;
    void **end;
    void **capacity;
} RawPointerVector;

typedef struct ManagementPolicyProbe {
    uint32_t fields[18];
} ManagementPolicyProbe;

typedef struct ProbeState {
    uintptr_t module_base;
    unsigned int objects;
    unsigned int tracks;
    unsigned int parts;
    unsigned int max_depth;
    void *first_part;
    void *visited[8192];
    unsigned int visited_count;
} ProbeState;

typedef struct DaisyEncodeOptions {
    void *musical_part;
    void *sequence_time_map;
} DaisyEncodeOptions;

static LONG WINAPI report_unhandled_exception(EXCEPTION_POINTERS *info) {
    HMODULE vsq = GetModuleHandleW(L"Vsq3.dll");
    uintptr_t address = (uintptr_t)info->ExceptionRecord->ExceptionAddress;
    uintptr_t rva = vsq && address >= (uintptr_t)vsq
                        ? address - (uintptr_t)vsq
                        : 0;
    fprintf(stderr,
            "unhandled exception: code=0x%08lx address=0x%08lx vsq_rva=0x%08lx\n",
            (unsigned long)info->ExceptionRecord->ExceptionCode,
            (unsigned long)address, (unsigned long)rva);
    fflush(stderr);
    return EXCEPTION_EXECUTE_HANDLER;
}

enum {
    RVA_VC9_POINTER_VECTOR_CTOR = 0x725b0,
    RVA_IAT_VC9_WSTRING_DTOR = 0x7f0ac,
    RVA_IAT_VC9_WSTRING_CTOR = 0x7f0d8,
    RVA_VSQ_ROOT_PRIMARY_VTABLE = 0x85258,
    RVA_MUSICAL_PART_PRIMARY_VTABLE = 0x85ac4,
    RVA_VS_TRACK_PRIMARY_VTABLE = 0x85d1c,
};

static FARPROC require_proc(HMODULE module, const char *name) {
    FARPROC proc = GetProcAddress(module, name);
    if (!proc) {
        fprintf(stderr, "missing export: %s (win32=%lu)\n", name,
                (unsigned long)GetLastError());
    }
    return proc;
}

static HMODULE find_loaded_module(const wchar_t *needle) {
    HANDLE snapshot;
    MODULEENTRY32W entry;
    HMODULE result = NULL;
    snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, GetCurrentProcessId());
    if (snapshot == INVALID_HANDLE_VALUE) {
        return NULL;
    }
    memset(&entry, 0, sizeof(entry));
    entry.dwSize = sizeof(entry);
    if (Module32FirstW(snapshot, &entry)) {
        do {
            if (wcsstr(entry.szModule, needle)) {
                result = entry.hModule;
                fwprintf(stderr, L"probe: loaded module %ls at 0x%08lx\n",
                         entry.szModule, (unsigned long)(uintptr_t)entry.hModule);
                break;
            }
        } while (Module32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);
    return result;
}

#define LOAD_PROC(module, destination, name)                                  \
    do {                                                                      \
        FARPROC raw_proc = require_proc((module), (name));                    \
        _Static_assert(sizeof(destination) == sizeof(raw_proc),               \
                       "unexpected function pointer size");                  \
        memcpy(&(destination), &raw_proc, sizeof(destination));               \
    } while (0)

static int was_visited(ProbeState *state, void *object) {
    unsigned int index;
    for (index = 0; index < state->visited_count; ++index) {
        if (state->visited[index] == object) {
            return 1;
        }
    }
    if (state->visited_count < sizeof(state->visited) / sizeof(state->visited[0])) {
        state->visited[state->visited_count++] = object;
    }
    return 0;
}

static int wide_to_ansi(const wchar_t *input, char *output, int output_size) {
    int converted = WideCharToMultiByte(CP_ACP, WC_NO_BEST_FIT_CHARS, input, -1,
                                        output, output_size, NULL, NULL);
    return converted > 0;
}

static void write_u16_le(FILE *file, uint16_t value) {
    unsigned char bytes[2] = {(unsigned char)value, (unsigned char)(value >> 8)};
    fwrite(bytes, 1, sizeof(bytes), file);
}

static void write_u32_le(FILE *file, uint32_t value) {
    unsigned char bytes[4] = {
        (unsigned char)value,
        (unsigned char)(value >> 8),
        (unsigned char)(value >> 16),
        (unsigned char)(value >> 24),
    };
    fwrite(bytes, 1, sizeof(bytes), file);
}

static int write_pcm16_mono_wav(const wchar_t *output_path,
                                const unsigned char *pcm,
                                unsigned int pcm_bytes,
                                unsigned int sample_rate) {
    FILE *file;
    if (GetFileAttributesW(output_path) != INVALID_FILE_ATTRIBUTES) {
        fwprintf(stderr, L"refusing to overwrite existing output: %ls\n", output_path);
        return 0;
    }
    file = _wfopen(output_path, L"wb");
    if (!file) {
        fwprintf(stderr, L"cannot create output WAV: %ls\n", output_path);
        return 0;
    }
    fwrite("RIFF", 1, 4, file);
    write_u32_le(file, 36u + pcm_bytes);
    fwrite("WAVEfmt ", 1, 8, file);
    write_u32_le(file, 16);
    write_u16_le(file, 1);
    write_u16_le(file, 1);
    write_u32_le(file, sample_rate);
    write_u32_le(file, sample_rate * 2u);
    write_u16_le(file, 2);
    write_u16_le(file, 16);
    fwrite("data", 1, 4, file);
    write_u32_le(file, pcm_bytes);
    if (fwrite(pcm, 1, pcm_bytes, file) != pcm_bytes || fclose(file) != 0) {
        fwprintf(stderr, L"failed while writing output WAV: %ls\n", output_path);
        return 0;
    }
    return 1;
}

static int render_first_part(const wchar_t *runtime_dir,
                             const wchar_t *voice_db_dir,
                             const wchar_t *output_path,
                             HMODULE vsq_module,
                             void *manager,
                             void *musical_part) {
    enum { SAMPLE_RATE = 44100 };
    unsigned char daisy_encoder_storage[128] = {0};
    unsigned char wave_storage[256] = {0};
    unsigned char synth_storage[2048] = {0};
    wchar_t dscl_path[MAX_PATH * 4];
    wchar_t dse_path[MAX_PATH * 4];
    char voice_db_ansi[MAX_PATH * 4];
    HMODULE dscl_module;
    HMODULE dse_module;
    GetMasterTrackFn get_master_track;
    CreateTimeMapFn create_time_map;
    ObjectCtorNoArgsFn construct_daisy_encoder;
    EncodePartFn encode_part;
    WaveCtorFn construct_wave;
    ObjectCtorNoArgsFn construct_synth;
    OpenSynthFn open_synth;
    SetDbmPathFn set_dbm_path;
    DoSynthesisFn do_synthesis;
    CloseSynthFn close_synth;
    FlushWaveFn flush_wave;
    GetWaveDataBytesFn get_wave_data_bytes;
    GetWaveDataFn get_wave_data;
    void *master_track;
    void *time_map;
    DaisyEncodeOptions encode_options;
    void *daisy_buffer;
    unsigned int pcm_bytes;
    unsigned int copied_bytes;
    unsigned char *pcm;
    const int16_t *samples;
    unsigned int sample_count;
    unsigned int index;
    unsigned int nonzero_samples = 0;
    int peak = 0;
    double sum_squares = 0.0;
    double rms;
    int dbm_result;
    int synthesis_result;

    if (!musical_part) {
        fputs("render requires at least one musical part\n", stderr);
        return 0;
    }
    if (swprintf(dscl_path, sizeof(dscl_path) / sizeof(dscl_path[0]),
                 L"%ls\\DSCL3.dll", runtime_dir) < 0 ||
        swprintf(dse_path, sizeof(dse_path) / sizeof(dse_path[0]),
                 L"%ls\\DSE3.dll", runtime_dir) < 0 ||
        !wide_to_ansi(voice_db_dir, voice_db_ansi, sizeof(voice_db_ansi))) {
        fputs("runtime or voice DB path is too long/unrepresentable\n", stderr);
        return 0;
    }
    dscl_module = LoadLibraryW(dscl_path);
    if (!dscl_module) {
        fwprintf(stderr, L"cannot load %ls (win32=%lu)\n", dscl_path,
                 (unsigned long)GetLastError());
        return 0;
    }

    LOAD_PROC(vsq_module, get_master_track,
              "?vsqGetCurrentMasterTrack@CVSVsqManagerIF@@QAEPAVIVSMasterTrack@@XZ");
    LOAD_PROC(dscl_module, create_time_map,
              "?CreateVSSequenceTimeMap@CxDaisyMidiFile@@SAPAUtagSequenceTimeMap@@PBVIVSMasterTrack@@@Z");
    LOAD_PROC(dscl_module, construct_daisy_encoder, "??0CxDaisyMidiFile@@QAE@XZ");
    LOAD_PROC(dscl_module, encode_part,
              "?EncodeMusicalPart@CxDaisyMidiFile@@QAEPAVCDaisyMidiBuffer@@PAUtagDaisyMidiV3EncodeStruct@@@Z");
    LOAD_PROC(dscl_module, construct_wave, "??0CWaveFile@@QAE@K@Z");
    LOAD_PROC(dscl_module, construct_synth, "??0CRtSynthesis@@QAE@XZ");
    LOAD_PROC(dscl_module, open_synth,
              "?OpenSynthesizer@CRtSynthesis@@QAEHPB_WN@Z");
    LOAD_PROC(dscl_module, set_dbm_path,
              "?SetDBMPath@CRtSynthesis@@QAEHPBD0@Z");
    LOAD_PROC(dscl_module, do_synthesis,
              "?DoSynthesis@CRtSynthesis@@QAEHPAVCDaisyMidiBuffer@@PAVCWaveFile@@KK_NPBD2MM@Z");
    LOAD_PROC(dscl_module, close_synth,
              "?CloseSynthesizer@CRtSynthesis@@QAEHXZ");
    LOAD_PROC(dscl_module, flush_wave, "?Flush@CWaveFile@@UAEXXZ");
    LOAD_PROC(dscl_module, get_wave_data_bytes,
              "?GetWaveDataByte@CWaveFile@@QAEKXZ");
    LOAD_PROC(dscl_module, get_wave_data,
              "?GetWaveData@CWaveFile@@QAEKPAEK@Z");
    if (!get_master_track || !create_time_map || !construct_daisy_encoder ||
        !encode_part || !construct_wave || !construct_synth || !open_synth ||
        !set_dbm_path || !do_synthesis || !close_synth || !flush_wave ||
        !get_wave_data_bytes || !get_wave_data) {
        FreeLibrary(dscl_module);
        return 0;
    }

    fputs("render: creating Vocaloid sequence time map\n", stderr);
    master_track = get_master_track(manager);
    time_map = master_track ? create_time_map(master_track) : NULL;
    if (!time_map) {
        fputs("could not create sequence time map\n", stderr);
        FreeLibrary(dscl_module);
        return 0;
    }
    construct_daisy_encoder(daisy_encoder_storage);
    encode_options.musical_part = musical_part;
    encode_options.sequence_time_map = time_map;
    daisy_buffer = encode_part(daisy_encoder_storage, &encode_options);
    if (!daisy_buffer) {
        fputs("could not encode musical part to Daisy events\n", stderr);
        FreeLibrary(dscl_module);
        return 0;
    }

    construct_wave(wave_storage, 4096);
    construct_synth(synth_storage);
    fputs("render: opening DSE3 synthesizer\n", stderr);
    if (!open_synth(synth_storage, dse_path, 20008017.0)) {
        fputs("OpenSynthesizer failed\n", stderr);
        FreeLibrary(dscl_module);
        return 0;
    }
    fprintf(stderr,
            "render: DSE module=0x%08lx create=0x%08lx static=0x%08lx "
            "dbm=0x%08lx step=0x%08lx start=0x%08lx stop=0x%08lx\n",
            (unsigned long)((uint32_t *)synth_storage)[237],
            (unsigned long)((uint32_t *)synth_storage)[239],
            (unsigned long)((uint32_t *)synth_storage)[241],
            (unsigned long)((uint32_t *)synth_storage)[247],
            (unsigned long)((uint32_t *)synth_storage)[243],
            (unsigned long)((uint32_t *)synth_storage)[244],
            (unsigned long)((uint32_t *)synth_storage)[245]);
    /* Despite the public method name, DSE3 treats the first argument as a
       printf-style registry-key format. It substitutes "COMMON" and reads
       HKLM\SOFTWARE\VCLDASGN3\COMMON\INSTALL before enumerating the fixed
       DATABASE\VOICE2 and DATABASE\VOICE3 registry branches. The second
       argument is checked for NULL by this pinned DSE3 build but otherwise is
       not consumed. Keep the caller-provided VoiceDB path there for ABI
       compatibility and diagnostics. */
    dbm_result = set_dbm_path(synth_storage,
                              "SOFTWARE\\VCLDASGN3\\%s",
                              voice_db_ansi);
    fprintf(stderr, "render: DSESetDBMPath result=%d\n", dbm_result);
    dse_module = GetModuleHandleW(L"DSE3.dll");
    if (dbm_result != 0 && dse_module) {
        /* Development diagnostic for the pinned DSE3.dll. DSESetDBMPath
           returns only the VOICE3 result, hiding whether VOICE2 failed first.
           These calls repeat the same read-only registry enumeration with
           separate labels so failures can be localized. */
        RegistryVoiceInitFn init_voice_registry =
            (RegistryVoiceInitFn)((uintptr_t)dse_module + 0x8180u);
        int voice2_result = init_voice_registry("DATABASE\\VOICE2");
        int voice3_result = init_voice_registry("DATABASE\\VOICE3");
        fprintf(stderr,
                "render: registry diagnostics voice2=%d voice3=%d\n",
                voice2_result, voice3_result);
    }
    fputs("render: synthesizing first musical part\n", stderr);
    synthesis_result = do_synthesis(
        synth_storage, daisy_buffer, wave_storage, SAMPLE_RATE, 1000, 0, NULL,
        0, 0.0f, 0.0f);
    close_synth(synth_storage);
    if (!synthesis_result) {
        fputs("DoSynthesis failed\n", stderr);
        FreeLibrary(dscl_module);
        return 0;
    }

    flush_wave(wave_storage);
    pcm_bytes = get_wave_data_bytes(wave_storage);
    if (!pcm_bytes || (pcm_bytes & 1u)) {
        fprintf(stderr, "invalid synthesized PCM byte count: %u\n", pcm_bytes);
        FreeLibrary(dscl_module);
        return 0;
    }
    pcm = (unsigned char *)malloc(pcm_bytes);
    if (!pcm) {
        fputs("cannot allocate PCM output buffer\n", stderr);
        FreeLibrary(dscl_module);
        return 0;
    }
    copied_bytes = get_wave_data(wave_storage, pcm, pcm_bytes);
    if (copied_bytes != pcm_bytes) {
        fprintf(stderr, "short PCM read: expected=%u actual=%u\n", pcm_bytes,
                copied_bytes);
        free(pcm);
        FreeLibrary(dscl_module);
        return 0;
    }
    samples = (const int16_t *)pcm;
    sample_count = pcm_bytes / 2u;
    for (index = 0; index < sample_count; ++index) {
        int value = samples[index];
        int absolute = value < 0 ? -value : value;
        if (value) {
            ++nonzero_samples;
        }
        if (absolute > peak) {
            peak = absolute;
        }
        sum_squares += (double)value * (double)value;
    }
    rms = sample_count ? sqrt(sum_squares / sample_count) : 0.0;
    if (!nonzero_samples || peak == 0 || rms < 0.01) {
        fprintf(stderr,
                "synthesized buffer is silent: samples=%u nonzero=%u peak=%d rms=%.3f\n",
                sample_count, nonzero_samples, peak, rms);
        free(pcm);
        FreeLibrary(dscl_module);
        return 0;
    }
    if (!write_pcm16_mono_wav(output_path, pcm, pcm_bytes, SAMPLE_RATE)) {
        free(pcm);
        FreeLibrary(dscl_module);
        return 0;
    }
    printf("{\"render_ok\":true,\"sample_rate\":%u,\"channels\":1,"
           "\"bits_per_sample\":16,\"samples\":%u,\"pcm_bytes\":%u,"
           "\"nonzero_samples\":%u,\"peak\":%d,\"rms\":%.3f}\n",
           SAMPLE_RATE, sample_count, pcm_bytes, nonzero_samples, peak, rms);
    fflush(stdout);
    free(pcm);
    FreeLibrary(dscl_module);
    return 1;
}

static uintptr_t primary_vtable_rva(ProbeState *state, void *generic_object) {
    void *primary_object;
    void **vtable;
    if (!generic_object) {
        return 0;
    }
    /* All observed Vsq3 concrete objects put IVSVsqObject at +4. */
    primary_object = (unsigned char *)generic_object - sizeof(void *);
    vtable = *(void ***)primary_object;
    if ((uintptr_t)vtable < state->module_base) {
        return 0;
    }
    return (uintptr_t)vtable - state->module_base;
}

static void walk_object(ProbeState *state, void *generic_object,
                        unsigned int depth) {
    RawPointerVector children = {0};
    void **vtable;
    EnumerateChildrenFn enumerate;
    RawVectorCtorFn construct_vector;
    uintptr_t rva;
    void *ctor_address;
    void **cursor;
    size_t count;

    if (!generic_object || depth > 32 || was_visited(state, generic_object)) {
        return;
    }
    ++state->objects;
    if (depth > state->max_depth) {
        state->max_depth = depth;
    }

    rva = primary_vtable_rva(state, generic_object);
    if (rva == RVA_VS_TRACK_PRIMARY_VTABLE) {
        ++state->tracks;
    } else if (rva == RVA_MUSICAL_PART_PRIMARY_VTABLE) {
        ++state->parts;
        if (!state->first_part) {
            state->first_part = (unsigned char *)generic_object - sizeof(void *);
        }
    }

    vtable = *(void ***)generic_object;
    if (!vtable) {
        return;
    }
    ctor_address = (void *)(state->module_base + RVA_VC9_POINTER_VECTOR_CTOR);
    memcpy(&construct_vector, &ctor_address, sizeof(construct_vector));
    construct_vector(&children);
    enumerate = (EnumerateChildrenFn)vtable[6];
    if (!enumerate || !enumerate(generic_object, &children)) {
        return;
    }
    if (!children.begin || !children.end || children.end < children.begin) {
        return;
    }
    count = (size_t)(children.end - children.begin);
    if (count > 100000) {
        fprintf(stderr, "refusing implausible child count: %lu\n",
                (unsigned long)count);
        return;
    }
    for (cursor = children.begin; cursor != children.end; ++cursor) {
        walk_object(state, *cursor, depth + 1);
    }
    /* Vsq3 allocated the backing store with the VC9 runtime. This short-lived
       probe intentionally lets process teardown reclaim it. The production
       helper resolves the matching VC9 operator delete. */
}

int wmain(int argc, wchar_t **argv) {
    unsigned char manager_storage[16] = {0};
    ManagementPolicyProbe policy = {{0}};
    ProbeState state = {0};
    wchar_t dll_path[MAX_PATH * 4];
    HMODULE vsq_module;
    HMODULE msvcp90_module;
    CtorFn construct;
    DtorFn destruct;
    SysInitializeFn initialize;
    LoadVsqFn load_vsq;
    GetLastErrorFn get_last_error;
    GetLastErrorMsgFn get_last_error_message;
    WStringCtorFn construct_wstring;
    WStringDtorFn destruct_wstring;
    WStringAssignFn assign_wstring;
    void *root;
    int initialize_result;
    unsigned int manager_error;
    const wchar_t *manager_message;
    void *runtime_proc;

    SetUnhandledExceptionFilter(report_unhandled_exception);
    if (argc != 3 && argc != 5) {
        fwprintf(stderr,
                 L"usage: vsq_probe.exe <Vocaloid3FE-dir> <project.vsqx> "
                 L"[output.wav VoiceDB-dir]\n");
        return 64;
    }
    if (!SetCurrentDirectoryW(argv[1]) || !SetDllDirectoryW(argv[1])) {
        fwprintf(stderr, L"cannot use runtime directory: %ls (win32=%lu)\n",
                 argv[1], (unsigned long)GetLastError());
        return 65;
    }
    if (swprintf(dll_path, sizeof(dll_path) / sizeof(dll_path[0]),
                 L"%ls\\Vsq3.dll", argv[1]) < 0) {
        fputs("Vsq3.dll path is too long\n", stderr);
        return 65;
    }
    vsq_module = LoadLibraryW(dll_path);
    if (!vsq_module) {
        fwprintf(stderr, L"cannot load %ls (win32=%lu)\n", dll_path,
                 (unsigned long)GetLastError());
        return 66;
    }
    state.module_base = (uintptr_t)vsq_module;
    msvcp90_module = find_loaded_module(L"MSVCP90");

    LOAD_PROC(vsq_module, construct, "??0CVSVsqManagerIF@@QAE@XZ");
    LOAD_PROC(vsq_module, destruct, "??1CVSVsqManagerIF@@QAE@XZ");
    LOAD_PROC(vsq_module, initialize,
              "?sysInitialize@CVSVsqManagerIF@@QAEHABUVSVsqManagementPolicy@@@Z");
    LOAD_PROC(vsq_module, load_vsq,
              "?fileLoadVsqFile@CVSVsqManagerIF@@QAEPAVIVSVsqRoot@@PB_W@Z");
    LOAD_PROC(vsq_module, get_last_error,
              "?sysGetLastError@CVSVsqManagerIF@@QBEIXZ");
    LOAD_PROC(vsq_module, get_last_error_message,
              "?sysGetLastErrorMsg@CVSVsqManagerIF@@QBEPB_WXZ");
    /* MSVCP90 is loaded through a VC9 side-by-side activation context and is
       not necessarily discoverable by name from this standalone helper. Read
       the already-resolved constructor/destructor pointers from Vsq3's IAT.
       These RVAs are guarded by the pinned Vsq3 fingerprint in production. */
    if (msvcp90_module) {
        LOAD_PROC(msvcp90_module, construct_wstring,
                  "??0?$basic_string@_WU?$char_traits@_W@std@@V?$allocator@_W@2@@std@@QAE@XZ");
        LOAD_PROC(msvcp90_module, destruct_wstring,
                  "??1?$basic_string@_WU?$char_traits@_W@std@@V?$allocator@_W@2@@std@@QAE@XZ");
        LOAD_PROC(msvcp90_module, assign_wstring,
                  "??4?$basic_string@_WU?$char_traits@_W@std@@V?$allocator@_W@2@@std@@QAEAAV01@PB_W@Z");
    } else {
        runtime_proc = *(void **)(state.module_base + RVA_IAT_VC9_WSTRING_CTOR);
        memcpy(&construct_wstring, &runtime_proc, sizeof(construct_wstring));
        runtime_proc = *(void **)(state.module_base + RVA_IAT_VC9_WSTRING_DTOR);
        memcpy(&destruct_wstring, &runtime_proc, sizeof(destruct_wstring));
        assign_wstring = NULL;
    }
    if (!construct || !destruct || !initialize || !load_vsq ||
        !get_last_error || !get_last_error_message || !construct_wstring ||
        !destruct_wstring || !assign_wstring) {
        FreeLibrary(vsq_module);
        return 67;
    }

    construct(manager_storage);
    /* VC9 VSVsqManagementPolicy: scalar limits/flags followed by a native
       std::wstring. Construct that field with the exact VC9 runtime instead of
       reproducing implementation-specific string internals. */
    policy.fields[0] = UINT32_MAX;
    policy.fields[1] = 16;
    policy.fields[2] = UINT32_MAX;
    policy.fields[3] = 1;
    policy.fields[4] = 1;
    policy.fields[5] = UINT32_MAX;
    policy.fields[6] = 1;
    policy.fields[7] = UINT32_MAX;
    policy.fields[8] = UINT32_MAX;
    policy.fields[9] = 60;
    policy.fields[10] = UINT32_MAX;
    policy.fields[11] = UINT32_MAX;
    construct_wstring(&policy.fields[12]);
    assign_wstring(&policy.fields[12], argv[1]);
    fprintf(stderr,
            "probe: policy string words=%08lx,%08lx,%08lx,%08lx,%08lx,%08lx\n",
            (unsigned long)policy.fields[12], (unsigned long)policy.fields[13],
            (unsigned long)policy.fields[14], (unsigned long)policy.fields[15],
            (unsigned long)policy.fields[16], (unsigned long)policy.fields[17]);
    fputs("probe: initializing Vsq manager\n", stderr);
    fflush(stderr);
    initialize_result = initialize(manager_storage, &policy);
    destruct_wstring(&policy.fields[12]);
    if (!initialize_result) {
        manager_error = get_last_error(manager_storage);
        manager_message = get_last_error_message(manager_storage);
        fwprintf(stderr, L"Vsq manager initialization failed: 0x%08x %ls\n",
                 manager_error, manager_message ? manager_message : L"");
        destruct(manager_storage);
        FreeLibrary(vsq_module);
        return 68;
    }

    fputs("probe: loading VSQX\n", stderr);
    fflush(stderr);

    root = load_vsq(manager_storage, argv[2]);
    if (!root) {
        manager_error = get_last_error(manager_storage);
        manager_message = get_last_error_message(manager_storage);
        fwprintf(stderr, L"VSQX load failed: 0x%08x %ls\n", manager_error,
                 manager_message ? manager_message : L"");
        destruct(manager_storage);
        FreeLibrary(vsq_module);
        return 69;
    }

    fputs("probe: walking native object tree\n", stderr);
    fflush(stderr);

    /* fileLoadVsqFile returns IVSVsqRoot (primary interface); IVSVsqObject is
       the adjacent secondary interface used for generic child enumeration. */
    walk_object(&state, (unsigned char *)root + sizeof(void *), 0);
    printf("{\"ok\":true,\"objects\":%u,\"tracks\":%u,\"musical_parts\":%u,"
           "\"max_depth\":%u,\"first_part\":\"0x%08lx\"}\n",
           state.objects, state.tracks, state.parts, state.max_depth,
           (unsigned long)(uintptr_t)state.first_part);
    fflush(stdout);

    if (argc == 5 &&
        !render_first_part(argv[1], argv[4], argv[3], vsq_module,
                           manager_storage, state.first_part)) {
        destruct(manager_storage);
        FreeLibrary(vsq_module);
        return 71;
    }

    destruct(manager_storage);
    FreeLibrary(vsq_module);
    return state.parts ? 0 : 70;
}
