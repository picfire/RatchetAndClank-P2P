#include <stdexcept>
#include <fstream>
#include <iostream>
#include "compression.h"

int main(int argc, char **argv) {
    if (argc != 4) return 1;
    try {
        uint64_t offset = std::stoull(argv[2]);
        uint64_t bytes = std::stoull(argv[3]);
        if (bytes > 1024 * 1024) return 2;
        std::ifstream disc(argv[1], std::ios::binary | std::ios::ate);
        if (!disc || offset > (uint64_t)disc.tellg() ||
            bytes > (uint64_t)disc.tellg() - offset) return 2;
        disc.seekg(offset);
        std::vector<uint8_t> compressed(bytes);
        if (!disc.read((char *)compressed.data(), bytes)) return 3;
        std::vector<uint8_t> decoded;
        if (!decompress_wad(decoded, compressed)) return 4;
        if (decoded.size() > 16 * 1024 * 1024) return 5;
        std::cout.write((const char *)decoded.data(), decoded.size());
        return std::cout ? 0 : 6;
    } catch (const std::exception &) {
        return 7;
    }
}