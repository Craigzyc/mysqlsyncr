<template>
    <div class="definition-diff">
        <div class="row items-center q-gutter-md q-mb-sm">
            <span class="legend legend-removed">− {{ expectedLabel }}</span>
            <span class="legend legend-added">+ {{ currentLabel }}</span>
            <q-space />
            <q-toggle v-model="changesOnly" dense label="Changes only" />
            <q-toggle v-model="ignoreWhitespace" dense label="Ignore whitespace" />
        </div>
        <div v-if="!hasChanges" class="text-grey q-pa-sm">
            No differences{{ ignoreWhitespace ? ' apart from whitespace' : '' }}.
        </div>
        <div v-else class="diff-code">
            <div v-for="(row, i) in visibleRows" :key="i" :class="['diff-line', `diff-${row.kind}`]">
                <span class="diff-no">{{ row.templateNo ?? '' }}</span>
                <span class="diff-no">{{ row.databaseNo ?? '' }}</span>
                <span class="diff-mark">{{ marks[row.kind] }}</span>
                <span class="diff-text">{{ row.text }}</span>
            </div>
        </div>
    </div>
</template>

<script>
import { diffLines } from 'diff'

// Unchanged lines kept around each change when showing changes only
const CONTEXT_LINES = 3

const withTrailingNewline = (text) => {
    const normalized = (text ?? '').replace(/\r\n/g, '\n')
    return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

// Same rule the comparison uses: runs of whitespace count as one space
const collapseWhitespace = (line) => line.replace(/\s+/g, ' ').trim()

/**
 * Line-by-line comparison of two versions of a definition: by default the
 * template's and the database's, or any two given labels.
 */
export default {
    name: 'DefinitionDiff',
    props: {
        expected: { type: String, default: '' },
        current: { type: String, default: '' },
        expectedLabel: { type: String, default: 'Template (expected)' },
        currentLabel: { type: String, default: 'Database (current)' },
    },
    data() {
        return {
            changesOnly: true,
            ignoreWhitespace: true,
            marks: { same: ' ', removed: '−', added: '+', skip: '' },
        }
    },
    computed: {
        // [{ kind: 'same' | 'removed' | 'added', text, templateNo, databaseNo }]
        rows() {
            const options = this.ignoreWhitespace
                ? { comparator: (left, right) => collapseWhitespace(left) === collapseWhitespace(right) }
                : {}
            const parts = diffLines(withTrailingNewline(this.expected), withTrailingNewline(this.current), options)
            const rows = []
            let templateNo = 1
            let databaseNo = 1
            for (const part of parts) {
                for (const text of part.value.replace(/\n$/, '').split('\n')) {
                    if (part.removed) rows.push({ kind: 'removed', text, templateNo: templateNo++ })
                    else if (part.added) rows.push({ kind: 'added', text, databaseNo: databaseNo++ })
                    else rows.push({ kind: 'same', text, templateNo: templateNo++, databaseNo: databaseNo++ })
                }
            }
            return rows
        },
        hasChanges() {
            return this.rows.some((row) => row.kind !== 'same')
        },
        visibleRows() {
            if (!this.changesOnly) return this.rows
            const keep = this.rows.map(() => false)
            this.rows.forEach((row, i) => {
                if (row.kind === 'same') return
                for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(this.rows.length - 1, i + CONTEXT_LINES); j++) {
                    keep[j] = true
                }
            })
            const visible = []
            let skipped = 0
            const addSkip = () => {
                if (skipped > 0) visible.push({ kind: 'skip', text: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'}` })
                skipped = 0
            }
            this.rows.forEach((row, i) => {
                if (keep[i]) {
                    addSkip()
                    visible.push(row)
                } else {
                    skipped++
                }
            })
            addSkip()
            return visible
        },
    },
}
</script>

<style scoped>
.diff-code {
    font-family: monospace;
    font-size: 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    overflow-x: auto;
    max-height: 60vh;
    overflow-y: auto;
}
.diff-line {
    display: flex;
    white-space: pre;
    min-width: max-content;
}
.diff-no {
    width: 3.5em;
    flex: none;
    text-align: right;
    padding-right: 0.5em;
    color: #999;
    user-select: none;
}
.diff-mark {
    width: 1.5em;
    flex: none;
    text-align: center;
    user-select: none;
}
.diff-removed {
    background: #ffebe9;
}
.diff-removed .diff-mark {
    color: #c62828;
}
.diff-added {
    background: #e6ffec;
}
.diff-added .diff-mark {
    color: #2e7d32;
}
.diff-skip {
    background: #f1f3f5;
    color: #777;
    font-style: italic;
}
.legend {
    font-family: monospace;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 3px;
}
.legend-removed {
    background: #ffebe9;
    color: #c62828;
}
.legend-added {
    background: #e6ffec;
    color: #2e7d32;
}
</style>
