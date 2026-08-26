/** Stand-in for @/lib/draftClient/fetchDraftOrderMatrix. */
import { snakeMatrix, ROUNDS } from './draftFixtures';
export interface DraftOrderSlot { round: number; pickNumber: number; teamId: string }
export async function fetchDraftOrderMatrix(): Promise<DraftOrderSlot[]> {
  return snakeMatrix(ROUNDS);
}
export default fetchDraftOrderMatrix;
