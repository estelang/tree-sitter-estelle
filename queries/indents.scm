(block "{" @indent)
(block "}" @outdent)
(list_literal "[" @indent)
(list_literal "]" @outdent)
(map_literal "{" @indent)
(map_literal "}" @outdent)
(binary_expression) @indent
