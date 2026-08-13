import { inngest } from "@/inngest/client";
import { runAgentTask } from "@/lib/ai-team/executor";
import type { AiAgentKey } from "@/lib/ai-team/types";
import { ensureNightlyProspecting, reconcileProspectingPipeline, recoverRateLimitedTasks } from "@/lib/ai-team/autonomy";

const agents: AiAgentKey[] = ["researcher", "sales", "controller"];

export const aiTeamScheduledRun = inngest.createFunction(
  {
    id: "ai-team-scheduled-run",
    name: "AI team: process assigned CRM tasks",
    concurrency: { limit: 1 },
    retries: 2,
    triggers: [{ cron: process.env.AI_TEAM_CRON ?? "*/15 * * * *" }],
  },
  async ({ step }) => {
    const queue = await step.run("ensure-nightly-prospecting", () => ensureNightlyProspecting());
    const recovery = await step.run("recover-rate-limited-tasks", () => recoverRateLimitedTasks());
    const results = [];
    for (const agent of agents) {
      results.push(
        await step.run(`run-${agent}`, () => runAgentTask(agent))
      );
    }
    const pipeline = await step.run("reconcile-prospecting-pipeline", () => reconcileProspectingPipeline());
    return { queue, recovery, results, pipeline };
  }
);

export const aiTeamTaskRun = inngest.createFunction(
  {
    id: "ai-team-task-run",
    name: "AI team: process one assigned CRM task",
    concurrency: [{ limit: 1, key: "event.data.taskId" }],
    retries: 2,
    triggers: [{ event: "ai-team/task.run" }],
  },
  async ({ event, step }) => {
    const { agent, taskId } = event.data as {
      agent: AiAgentKey;
      taskId: string;
    };
    if (!agents.includes(agent)) throw new Error(`Unknown AI agent: ${agent}`);
    return step.run("run-agent-task", () => runAgentTask(agent, taskId));
  }
);
