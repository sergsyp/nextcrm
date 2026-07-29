import { getApiKey } from "./api-keys";
import { createOpenAIClient } from "./ai-config";

//Check if the openai key is in the database
//If not, use the env variable

export async function openAiHelper(userId: string) {
  const apiKey = await getApiKey("OPENAI", userId);

  if (!apiKey) {
    console.log("No API key found in the environment");
    return null;
  }

  //console.log(apiKey, "apiKey");
  const openai = createOpenAIClient(apiKey);

  return openai;
}
