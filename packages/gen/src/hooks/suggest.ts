/**
 * Command suggestion helper using Levenshtein distance
 */

import { distance } from "fastest-levenshtein";

/**
 * Get command suggestions based on Levenshtein distance
 *
 * @param input - The input string to match against
 * @param candidates - List of valid command/kit names
 * @param maxDistance - Maximum edit distance to consider (default: 3)
 * @returns Array of suggestions sorted by distance (closest first)
 */
export function getSuggestions(input: string, candidates: string[], maxDistance = 3): string[] {
	if (!input || candidates.length === 0) {
		return [];
	}

	// Calculate distances and filter by threshold
	const matches = candidates
		.map((candidate) => ({
			candidate,
			distance: distance(input.toLowerCase(), candidate.toLowerCase()),
		}))
		.filter((match) => match.distance <= maxDistance)
		.sort((a, b) => a.distance - b.distance)
		.map((match) => match.candidate);

	return matches;
}
