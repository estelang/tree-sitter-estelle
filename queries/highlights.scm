(line_comment) @comment
(block_comment) @comment

[
  "fnc" "pub" "import" "as"
  "return" "output"
  "if" "else"
  "for" "in"
  "while" "repeat"
  "try" "catch"
  "lua"
  "and" "or" "not"
] @keyword

(break_statement) @keyword
(continue_statement) @keyword

(str) @type.builtin
(num) @type.builtin
(bool) @type.builtin
(list) @type.builtin
(map) @type.builtin

(true) @boolean
(false) @boolean
(nil) @constant.builtin
(number) @number

(string) @string
(string (escape_sequence) @string.escape)

;; ${...} delimiters are scanner externals and not present as queryable children.
;; We only mark the interpolation node; the inner expression is re-highlighted via injection.
(interpolation) @embedded

(function_declaration name: (identifier) @function)
(call_expression callee: (identifier) @function)
(pipe_expression function: (identifier) @function)
(method_call_expression method: (identifier) @function.method)

(parameter name: (identifier) @variable.parameter)

[
  "=" "+=" "=>"
  "==" "!=" "<" ">" "<=" ">="
  "+" "-" "*" "/" "%"
  ".." "|" "?"
] @operator

["(" ")" "[" "]" "{" "}"] @punctuation.bracket
["," ":" "."] @punctuation.delimiter

(map_entry key: (identifier) @property)

(import_declaration path: (string) @string.special)
(import_declaration alias: (identifier) @type)

(identifier) @variable

((call_expression callee: (identifier) @function.builtin)
 (#match? @function.builtin
  "^(trim|lower|upper|sub|find|replace|split|join|floor|ceil|abs|round|tonum|tostr|len|push|pop|has|default|padleft|padright|page|currentpage|addWarning|allToString|clone|getCurrentFrame|incrementExpensiveFunctionCount|isSubsting|loadData|loadJsonData|dumpObject|log|logObject)$"))
