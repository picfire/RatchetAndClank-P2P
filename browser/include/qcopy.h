#ifndef RNC_BROWSER_QCOPY_H
#define RNC_BROWSER_QCOPY_H

static inline void qcopy(void *destination, void *source) {
    __builtin_memcpy(destination, source, 16);
}

static inline void qcopy_nc(void *destination, void *source) {
    __builtin_memcpy(destination, source, 16);
}

#endif