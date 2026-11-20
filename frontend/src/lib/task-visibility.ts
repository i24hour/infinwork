export function allTasksAreHidden(
    tasks: Array<{ isPublic?: boolean | null }>,
    preference = false
): boolean {
    if (tasks.length === 0) return preference;
    return tasks.every((task) => task.isPublic === false);
}
