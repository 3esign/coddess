import { nanoid } from 'nanoid';
import type { NormalizedEntry, Project } from '@coddess/shared';
import { ENABLE_CRITIQUE } from '../config.js';
import { chatPaths, readMessages, appendHistory } from './chatStore.js';
import { chatStream } from './provider/providerRouter.js';

type Emit = (e: NormalizedEntry) => void;

/**
 * Optional post-run "Coddess Observer" critique. It costs a full extra model
 * call, so it is OFF by default (enable with CODDESS_ENABLE_CRITIQUE=1). When
 * disabled this is a no-op, keeping the run cheap — especially on local models.
 */
export async function runCritique(
  project: Project,
  chatId: string,
  model: string,
  emit: Emit,
): Promise<void> {
  if (!ENABLE_CRITIQUE) return;

  const p = chatPaths(project, chatId);
  const messages = readMessages(p);
  if (messages.length === 0) return;
  const conversation = messages.filter((m) => m.role !== 'system');

  const criticPrompt = `You are Coddess, the general intelligence observer for the Coddess platform.
Analyze the following software development interaction:
${JSON.stringify(conversation, null, 2)}

Provide a highly concise, 1-2 paragraph technical observation of the system state.
Do NOT list to-dos, step-by-step instructions, or write in a tutoring or conversational tone.
Focus purely on:
- The technical status and architecture of the implemented code.
- A direct, high-level evaluation of the current system design and its alignment with the project trajectory.`;

  const runId = nanoid(8);
  const base = { runId, projectId: project.id, chatId };

  try {
    emit({ kind: 'assistant_message', ...base, ts: Date.now(), text: '🔎 Coddess Observer is reviewing this interaction...' });
    let full = '';
    for await (const chunk of chatStream(model, [
      { role: 'system', content: 'You are Coddess, the elite intelligence auditor.' },
      { role: 'user', content: criticPrompt },
    ])) {
      full += chunk;
      emit({ kind: 'coddess_opinion', ...base, ts: Date.now(), text: chunk });
    }
    emit({ kind: 'coddess_opinion', ...base, ts: Date.now(), text: '__DONE__' });
    appendHistory(p, { kind: 'coddess_opinion', ...base, ts: Date.now(), text: full });
  } catch (err) {
    console.error('Failed to run Coddess critique:', err);
  }
}
