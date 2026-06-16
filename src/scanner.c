#include "tree_sitter/parser.h"
#include <stdlib.h>
#include <string.h>

typedef enum {
  STRING_START,
  STRING_CONTENT,
  STRING_END,
  INTERP_START,
  INTERP_END,
  LUA_BLOCK,
  OUTPUT_BLOCK,
} TokenType;

typedef struct {
  char quote_stack[8];
  uint8_t quote_depth;
  int interp_brace_depth;
  bool in_interpolation;
  // required to correctly handle quotes inside ${...} (e.g. "${foo("bar")}")
  // see is_active_string in scan()
  uint8_t interp_at_quote_depth;
} Scanner;

void *tree_sitter_estelle_external_scanner_create(void) {
  Scanner *s = calloc(1, sizeof(Scanner));
  return s;
}

void tree_sitter_estelle_external_scanner_destroy(void *payload) {
  free(payload);
}

unsigned tree_sitter_estelle_external_scanner_serialize(void *payload,
                                                        char *buffer) {
  Scanner *s = payload;
  unsigned size = 0;
  buffer[size++] = (char)s->quote_depth;
  for (uint8_t i = 0; i < s->quote_depth; i++)
    buffer[size++] = s->quote_stack[i];
  memcpy(buffer + size, &s->interp_brace_depth, sizeof(int));
  size += sizeof(int);
  buffer[size++] = (char)s->in_interpolation;
  buffer[size++] = (char)s->interp_at_quote_depth;
  return size;
}

void tree_sitter_estelle_external_scanner_deserialize(void *payload,
                                                      const char *buffer,
                                                      unsigned length) {
  if (length == 0)
    return;
  Scanner *s = payload;
  unsigned pos = 0;
  s->quote_depth = (uint8_t)buffer[pos++];
  for (uint8_t i = 0; i < s->quote_depth && pos < length; i++)
    s->quote_stack[i] = buffer[pos++];
  if (pos + sizeof(int) <= length) {
    memcpy(&s->interp_brace_depth, buffer + pos, sizeof(int));
    pos += sizeof(int);
  }
  if (pos < length)
    s->in_interpolation = (bool)buffer[pos++];
  if (pos < length)
    s->interp_at_quote_depth = (uint8_t)buffer[pos];
}

static void skip_whitespace(TSLexer *lexer) {
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
         lexer->lookahead == '\r' || lexer->lookahead == '\n')
    lexer->advance(lexer, true);
}

static bool scan_raw_block(TSLexer *lexer) {
  int depth = 1;
  while (lexer->lookahead != 0) {
    char c = lexer->lookahead;
    lexer->advance(lexer, false);
    if (c == '{')
      depth++;
    else if (c == '}') {
      depth--;
      if (depth == 0) {
        lexer->result_symbol = LUA_BLOCK; // caller may override to OUTPUT_BLOCK
        return true;
      }
    } else if (c == '"' || c == '\'') {
      char q = c;
      while (lexer->lookahead != 0) {
        char sc = lexer->lookahead;
        lexer->advance(lexer, false);
        if (sc == '\\') {
          if (lexer->lookahead != 0)
            lexer->advance(lexer, false);
          continue;
        }
        if (sc == q)
          break;
      }
    } else if (c == '/' && lexer->lookahead == '/') {
      while (lexer->lookahead != 0 && lexer->lookahead != '\n')
        lexer->advance(lexer, false);
    } else if (c == '/' && lexer->lookahead == '*') {
      lexer->advance(lexer, false);
      while (lexer->lookahead != 0) {
        char sc = lexer->lookahead;
        lexer->advance(lexer, false);
        if (sc == '*' && lexer->lookahead == '/') {
          lexer->advance(lexer, false);
          break;
        }
      }
    }
  }
  return false;
}

bool tree_sitter_estelle_external_scanner_scan(void *payload, TSLexer *lexer,
                                               const bool *valid_symbols) {
  Scanner *s = payload;

  if (valid_symbols[INTERP_END] && s->in_interpolation) {
    if (lexer->lookahead == '}') {
      if (s->interp_brace_depth == 0) {
        lexer->advance(lexer, false);
        s->in_interpolation = false;
        s->interp_at_quote_depth = 0;
        lexer->result_symbol = INTERP_END;
        return true;
      }
      s->interp_brace_depth--;
      return false;
    } else if (lexer->lookahead == '{') {
      s->interp_brace_depth++;
      return false;
    }
    // allow STRING_START etc. for literals inside the interpolation expression
  }

  if (s->quote_depth > 0) {
    uint8_t active_base = s->in_interpolation ? s->interp_at_quote_depth : 0;
    bool is_active_string = (s->quote_depth > active_base);

    if (is_active_string) {
      char current_quote = s->quote_stack[s->quote_depth - 1];

      if (valid_symbols[INTERP_START] && lexer->lookahead == '$') {
        lexer->advance(lexer, false);
        if (lexer->lookahead == '{') {
          lexer->advance(lexer, false);
          s->in_interpolation = true;
          s->interp_brace_depth = 0;
          s->interp_at_quote_depth = s->quote_depth;
          lexer->result_symbol = INTERP_START;
          return true;
        }
        lexer->result_symbol = STRING_CONTENT;
        return true;
      }

      if (valid_symbols[STRING_END] && lexer->lookahead == current_quote) {
        lexer->advance(lexer, false);
        s->quote_depth--;
        lexer->result_symbol = STRING_END;
        return true;
      }

      if (valid_symbols[STRING_CONTENT] && lexer->lookahead != 0) {
        bool advanced = false;
        while (lexer->lookahead != 0 && lexer->lookahead != current_quote &&
               !(lexer->lookahead == '$') && lexer->lookahead != '\\') {
          lexer->advance(lexer, false);
          advanced = true;
        }
        if (advanced) {
          lexer->result_symbol = STRING_CONTENT;
          return true;
        }
      }
      return false;
    }
    // Suspended outer string (quote_depth > 0 but not active):
    // inner quotes start new literals
    // do not treat them as closers, however.
  }

  if (valid_symbols[STRING_START]) {
    skip_whitespace(lexer);
    if ((lexer->lookahead == '"' || lexer->lookahead == '\'') &&
        s->quote_depth < 8) {
      char q = lexer->lookahead;
      lexer->advance(lexer, false);
      s->quote_stack[s->quote_depth++] = q;
      lexer->result_symbol = STRING_START;
      return true;
    }
  }

  if (valid_symbols[LUA_BLOCK]) {
    skip_whitespace(lexer);
    if (lexer->lookahead == '{') {
      lexer->advance(lexer, false);
      bool ok = scan_raw_block(lexer);
      if (ok)
        lexer->result_symbol = LUA_BLOCK;
      return ok;
    }
  }

  if (valid_symbols[OUTPUT_BLOCK]) {
    skip_whitespace(lexer);
    if (lexer->lookahead == '{') {
      lexer->advance(lexer, false);
      // output blocks may contain ${...}
      // let injections.scm handle any ${} as text
      // rather than Estelle expressions
      bool ok = scan_raw_block(lexer);
      if (ok)
        lexer->result_symbol = OUTPUT_BLOCK;
      return ok;
    }
  }

  return false;
}
