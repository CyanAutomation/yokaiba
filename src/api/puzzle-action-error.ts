export class PuzzleActionError extends TypeError {
  readonly code: "invalid_puzzle_token" | "unsupported_puzzle_version";

  constructor(code: PuzzleActionError["code"], message: string) {
    super(message);
    this.code = code;
  }
}
