export default grammar({
	name: "estelle",

	externals: ($) => [
		$._string_start,
		$._string_content,
		$._string_end,
		$._interp_start,
		$._interp_end,
		$._lua_block,
		$._output_block,
	],

	extras: ($) => [/\s/, $.line_comment, $.block_comment],

	word: ($) => $.identifier,

	conflicts: ($) => [
		// lambda vs _expression: => lookahead is not sufficient in all positions
		[$.lambda_expression, $._expression],
		// return greediness: the transpiler always takes an expr after 'return' unless '}' immediately follows
		[$.return_statement],
		// lambda body vs following postfix operators
		[$.coerce_expression, $.lambda_expression],
		[$.pipe_expression, $.lambda_expression],
	],

	rules: {
		source_file: ($) => repeat($._top_level),

		_top_level: ($) => choice($.import_declaration, $.function_declaration),

		import_declaration: ($) =>
			seq(
				"import",
				field("path", $.string),
				optional(seq("as", field("alias", $.identifier))),
			),

		function_declaration: ($) =>
			seq(
				optional("pub"),
				"fnc",
				field("name", $.identifier),
				optional(field("parameters", $.parameter_list)),
				optional(field("return_type", $._type)),
				field("body", $.block),
			),

		parameter_list: ($) => seq("(", commaSep($.parameter), ")"),

		parameter: ($) =>
			seq(
				field("name", $.identifier),
				field("type", $._type),
				optional("?"),
			),

		_type: ($) => choice($.str, $.num, $.bool, $.list, $.map),

		block: ($) => seq("{", repeat($._statement), "}"),

		_statement: ($) =>
			choice(
				$.function_declaration,
				$.if_statement,
				$.try_statement,
				$.lua_statement,
				$.for_range_statement,
				$.for_in_statement,
				$.while_statement,
				$.repeat_statement,
				$.break_statement,
				$.continue_statement,
				$.return_statement,
				$.output_statement,
				$.assign_statement,
				$.compound_assign_statement,
				$.expression_statement,
			),

		if_statement: ($) =>
			seq(
				"if",
				field("condition", $._expression),
				field("consequence", $.block),
				repeat(
					seq(
						"else",
						"if",
						field("condition", $._expression),
						field("consequence", $.block),
					),
				),
				optional(seq("else", field("alternative", $.block))),
			),

		try_statement: ($) =>
			seq(
				"try",
				field("body", $.block),
				optional(
					seq(
						"catch",
						optional(field("error", $.identifier)),
						field("handler", $.block),
					),
				),
			),

		lua_statement: ($) => seq("lua", $._lua_block),

		for_in_statement: ($) =>
			seq(
				"for",
				optional(seq(field("index", $.identifier), ",")),
				field("item", $.identifier),
				"in",
				field("iterable", $._expression),
				field("body", $.block),
			),

		for_range_statement: ($) =>
			prec(
				2,
				seq(
					"for",
					field("variable", $.identifier),
					"in",
					field("start", $._expression),
					"..",
					field("end", $._expression),
					field("body", $.block),
				),
			),

		while_statement: ($) =>
			seq(
				"while",
				field("condition", $._expression),
				field("body", $.block),
			),

		repeat_statement: ($) =>
			seq(
				"repeat",
				field("count", $._expression),
				field("body", $.block),
			),

		break_statement: (_) => "break",
		continue_statement: (_) => "continue",

		return_statement: ($) =>
			seq("return", optional(field("value", $._expression))),

		output_statement: ($) =>
			choice(
				seq("output", $._output_block),
				seq("output", field("value", $._expression)),
			),

		assign_statement: ($) =>
			seq(
				field("target", $._assign_target),
				"=",
				field("value", $._expression),
			),

		compound_assign_statement: ($) =>
			seq(
				field("target", $._assign_target),
				"+=",
				field("value", $._expression),
			),

		_assign_target: ($) =>
			choice($.identifier, $.member_expression, $.index_expression),

		expression_statement: ($) => $._expression,

		// precedence levels mirror expressionParser.ts in the transpiler
		// https://github.com/estelang/estelle/blob/master/src/compiler/parser/expressionParser.ts
		_expression: ($) =>
			choice(
				$.pipe_expression,
				$.binary_expression,
				$.unary_expression,
				$.coerce_expression,
				$.call_expression,
				$.method_call_expression,
				$.member_expression,
				$.index_expression,
				$.lambda_expression,
				$.string,
				$.number,
				$.true,
				$.false,
				$.nil,
				$.list_literal,
				$.map_literal,
				$.identifier,
				$._parenthesized_expr,
			),

		pipe_expression: ($) =>
			prec.left(
				0,
				seq(
					field("value", $._expression),
					"|",
					field("function", $.identifier),
					optional(seq("(", commaSep($._expression), ")")),
				),
			),

		binary_expression: ($) =>
			choice(
				prec.left(
					1,
					seq(
						field("left", $._expression),
						"or",
						field("right", $._expression),
					),
				),
				prec.left(
					2,
					seq(
						field("left", $._expression),
						"and",
						field("right", $._expression),
					),
				),
				prec.left(
					3,
					seq(
						field("left", $._expression),
						choice("==", "!=", ">", "<", ">=", "<="),
						field("right", $._expression),
					),
				),
				prec.right(
					4,
					seq(
						field("left", $._expression),
						"..",
						field("right", $._expression),
					),
				),
				prec.left(
					5,
					seq(
						field("left", $._expression),
						choice("+", "-"),
						field("right", $._expression),
					),
				),
				prec.left(
					6,
					seq(
						field("left", $._expression),
						choice("*", "/", "%"),
						field("right", $._expression),
					),
				),
			),

		unary_expression: ($) =>
			prec.right(
				7,
				seq(choice("not", "-"), field("operand", $._expression)),
			),

		coerce_expression: ($) =>
			seq(field("expr", $._expression), "as", field("type", $._type)),

		call_expression: ($) =>
			prec(
				8,
				seq(
					field("callee", $._expression),
					"(",
					field("arguments", commaSep($._expression)),
					")",
				),
			),

		method_call_expression: ($) =>
			prec(
				8,
				seq(
					field("object", $._expression),
					":",
					field("method", $.identifier),
					choice(
						seq(
							"(",
							field("arguments", commaSep($._expression)),
							")",
						),
						field("table", $.map_literal),
					),
				),
			),

		member_expression: ($) =>
			prec(
				8,
				seq(
					field("object", $._expression),
					".",
					field("property", $.identifier),
				),
			),

		index_expression: ($) =>
			prec(
				8,
				seq(
					field("object", $._expression),
					"[",
					field("index", $._expression),
					"]",
				),
			),

		lambda_expression: ($) =>
			seq(
				"(",
				optional(commaSep($.identifier)),
				")",
				"=>",
				field("body", $._expression),
			),

		_parenthesized_expr: ($) => seq("(", $._expression, ")"),

		list_literal: ($) => seq("[", commaSep($._expression), "]"),

		map_literal: ($) => seq("{", commaSep($.map_entry), "}"),

		map_entry: ($) =>
			seq(field("key", $.identifier), ":", field("value", $._expression)),

		// uses external scanner because ${} requires tracking nested braces and suspending quote state
		string: ($) =>
			seq(
				$._string_start,
				repeat(
					choice(
						$._string_content,
						$.escape_sequence,
						$.interpolation,
					),
				),
				$._string_end,
			),

		escape_sequence: (_) => token.immediate(/\\./),

		interpolation: ($) =>
			seq($._interp_start, $._expression, $._interp_end),

		identifier: (_) => /[a-zA-Z_][a-zA-Z0-9_]*/,

		number: (_) =>
			token(
				choice(
					/[0-9]+\.[0-9]+/, // float before integer cuz token choice order matters
					/[0-9]+/,
				),
			),

		line_comment: (_) => token(seq("//", /.*/)),

		block_comment: (_) => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),

		true: (_) => "true",
		false: (_) => "false",
		nil: (_) => "nil",

		str: (_) => "str",
		num: (_) => "num",
		bool: (_) => "bool",
		list: (_) => "list",
		map: (_) => "map",
	},
});

function commaSep(rule) {
	return optional(seq(rule, repeat(seq(",", rule)), optional(",")));
}
