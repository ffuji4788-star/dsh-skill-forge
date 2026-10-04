/**
 * Process exit codes used by the CLI.
 *
 * Defined in one place so no command can hard-code a number. The three
 * outcomes are deliberately distinct: a validation failure is a normal result
 * of running the tool (the skill is structurally incomplete), while a fatal
 * error means the tool could not even read or parse the input.
 */

/** Validation passed. Warnings do not change this. */
export const EXIT_SUCCESS = 0;

/** Fatal input, filesystem or parser error: the skill could not be read. */
export const EXIT_FATAL = 1;

/** Validation completed and found at least one `error` severity issue. */
export const EXIT_VALIDATION_FAILED = 2;
