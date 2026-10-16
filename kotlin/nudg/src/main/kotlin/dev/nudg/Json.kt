package dev.nudg

/** A small JSON reader, so the runtime has no dependencies: objects keep their key order. */
internal object Json {
    fun parse(text: String): Any? = Reader(text).run { val v = value(); ws(); require(i == s.length) { "Trailing characters at $i" }; v }

    private class Reader(val s: String) {
        var i = 0
        fun ws() { while (i < s.length && s[i].isWhitespace()) i++ }
        fun value(): Any? {
            ws()
            return when (val c = s[i]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> { i += 4; true }
                'f' -> { i += 5; false }
                'n' -> { i += 4; null }
                else -> if (c == '-' || c.isDigit()) num() else error("Unexpected '$c' at $i")
            }
        }
        fun obj(): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            i++; ws()
            if (s[i] == '}') { i++; return out }
            while (true) {
                ws(); val k = str(); ws(); i++ // ':'
                out[k] = value(); ws()
                if (s[i++] == '}') return out
            }
        }
        fun arr(): List<Any?> {
            val out = ArrayList<Any?>()
            i++; ws()
            if (s[i] == ']') { i++; return out }
            while (true) {
                out.add(value()); ws()
                if (s[i++] == ']') return out
            }
        }
        fun str(): String {
            val sb = StringBuilder()
            i++
            while (s[i] != '"') {
                if (s[i] == '\\') {
                    i++
                    when (val e = s[i]) {
                        'n' -> sb.append('\n'); 't' -> sb.append('\t'); 'r' -> sb.append('\r'); 'b' -> sb.append('\b'); 'f' -> sb.append('\u000c')
                        'u' -> { sb.append(s.substring(i + 1, i + 5).toInt(16).toChar()); i += 4 }
                        else -> sb.append(e)
                    }
                } else sb.append(s[i])
                i++
            }
            i++
            return sb.toString()
        }
        fun num(): Double {
            val start = i
            while (i < s.length && (s[i].isDigit() || s[i] in "+-.eE")) i++
            return s.substring(start, i).toDouble()
        }
    }
}
