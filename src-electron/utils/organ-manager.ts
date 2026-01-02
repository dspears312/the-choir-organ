import fs from 'fs';
import path from 'path';
import readline from 'readline';

/**
 * Scans an ODF file to find referenced folders relative to the ODF.
 * Provides improved support for distributed installation packages (e.g. extracted_organs structure).
 */
export async function scanOrganDependencies(odfPath: string): Promise<string[]> {
    const dependencies = new Set<string>();
    const odfDir = path.dirname(odfPath);

    // Always include the ODF file itself
    dependencies.add(odfPath);

    // Logic:
    // 1. Identify "Root Paths" requested by ODF (e.g. "InstallationPackages/002164" or "Data/Images")
    // 2. Locate these roots.
    //    - First check ODF sibling
    //    - Check ODF parent (e.g. if odf is in OrganDefinitions/, check ../)
    //    - Check ODF grandparent/siblings (e.g. if split across extracted_organs/)

    // We assume the containing folder of the ODF (or its parent) might be one of many in a "Pool" (extracted_organs).
    // Try to find the "Pool Root".
    let poolRoot: string | null = null;

    // Heuristic: Check if we are inside "OrganDefinitions".
    // .../extracted_organs/PkgA/OrganDefinitions/file.xml
    // Parent = OrganDefinitions
    // PkgA = ../..
    // Pool = ../../..

    const parts = odfPath.split(path.sep);
    const defIndex = parts.indexOf('OrganDefinitions'); // Standard HW folder
    if (defIndex > 0) {
        // Pool root should be TWO levels up from OrganDefinitions?
        // OrganDefinitions is inside PkgA. PkgA is inside Pool.
        // So Pool is parts[defIndex - 1] ... no, parts.slice(0, defIndex - 1).
        const poolParts = parts.slice(0, defIndex - 1);
        if (poolParts.length > 0) {
            poolRoot = poolParts.join(path.sep);
        }
    } else {
        // Fallback: If not standard structure, assume grandparent is pool (e.g. PkgA inside Pool)
        // odfDir = PkgA/Something
        // Pool = ../..
        poolRoot = path.resolve(odfDir, '..', '..');
    }

    const fileStream = fs.createReadStream(odfPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const neededRoots = new Set<string>();

    for await (const line of rl) {
        if (line.trim().startsWith('[') || !line.includes('=')) continue;

        const lineParts = line.split('=');
        if (lineParts.length < 2) continue;

        let value = lineParts[1].trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);

        if (value.includes('\\') || value.includes('/')) {
            const normalized = value.replace(/\\/g, '/');
            const segments = normalized.split('/').filter(s => s && s !== '.');

            if (segments.length > 0) {
                // If it starts with InstallationPackages/XXXXX, we want that XXXXX level
                // as it's likely the unique package identifier.
                // Standard folders: InstallationPackages, OrganInstallationPackages, Data
                const first = segments[0];
                if ((first === 'InstallationPackages' || first === 'OrganInstallationPackages') && segments.length > 1) {
                    neededRoots.add(`${first}/${segments[1]}`);
                } else {
                    // Just take the top level
                    neededRoots.add(first);
                }
            }
        }
    }

    // Helper to find a path in the pool
    const findInPool = (relativePath: string): string | null => {
        if (!poolRoot || !fs.existsSync(poolRoot)) return null;

        // Check if poolRoot IS the container (e.g. if we are just single folder)
        if (fs.existsSync(path.join(poolRoot, relativePath))) return path.join(poolRoot, relativePath);

        // Iterate all folders in pool (PkgA, PkgB...)
        try {
            const entries = fs.readdirSync(poolRoot, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const candidate = path.join(poolRoot, entry.name, relativePath);
                    if (fs.existsSync(candidate)) {
                        // Found it! Return the PACKAGE ROOT (entry), not the deep file.
                        // Why? Because we want to delete/measure the content provided by that package.
                        // But wait, if PkgA contains InstPkg/001 AND InstPkg/002, and we only need 001...
                        // Deleting PkgA deletes 002.
                        // For "extracted_organs", usually 1 RAR = 1 Folder.
                        // If that RAR contained both, then deleting the folder is correct (removes the RAR content).
                        return path.join(poolRoot, entry.name);
                    }
                }
            }
        } catch (e) { }
        return null;
    };

    // Resolve needed roots
    for (const needed of neededRoots) {
        // 1. Try relative to ODF dir
        const localPath = path.join(odfDir, needed);
        if (fs.existsSync(localPath)) {
            dependencies.add(localPath);
            continue;
        }

        // 2. Try relative to ODF's "Base" (parent of OrganDefinitions)
        // If odf is PkgA/OrganDefinitions/file.xml, we want PkgA/needed
        const parentPath = path.join(path.resolve(odfDir, '..'), needed);
        if (fs.existsSync(parentPath)) {
            // If we found it in the parent (same package), add it.
            // We add the specific folder (e.g. PkgA/InstallationPackages).
            // But if we delete PkgA later?
            // Actually, if we are deleting, we probably delete the whole "PkgA" folder if the ODF is in it.
            // So adding PkgA/InstallationPackages is fine, but maybe redundant if we delete PkgA.
            // Let's just track it.
            dependencies.add(parentPath);
            continue;
        }

        // 3. Try Pool Search (Cross-package)
        if (poolRoot) {
            const foundPkg = findInPool(needed);
            if (foundPkg) {
                dependencies.add(foundPkg);
            }
        }
    }

    // Also explicitly add the "Home Package" of the ODF (e.g. PkgA)
    // If ODF is in PkgA/OrganDefinitions, we should probably verify/delete PkgA too.
    if (defIndex > 0) {
        // ODF is deep
        // We want the folder at index defIndex - 1 (the one containing OrganDefinitions)
        // e.g. .../PkgA/OrganDefinitions/....
        // parts[defIndex-1] is PkgA
        // Full path to PkgA:
        const pkgRoot = parts.slice(0, defIndex).join(path.sep);
        if (fs.existsSync(pkgRoot)) {
            dependencies.add(pkgRoot);
        }
    } else {
        // Just add odfDir?
        // If the ODF is at root of PkgA, then PkgA is odfDir.
        dependencies.add(odfDir);
    }

    return Array.from(dependencies);
}
