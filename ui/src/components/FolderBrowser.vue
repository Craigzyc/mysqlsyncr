<template>
    <q-dialog v-model="isOpen" persistent>
        <q-card class="folder-browser-card">
            <q-card-section class="header-section row items-center justify-between">
                <div class="text-h6 text-white">Select Folder</div>
                <q-btn icon="close" flat round dense v-close-popup class="text-white" />
            </q-card-section>

            <q-card-section>
                <div class="path-section">
                    <div class="text-subtitle2 q-mb-sm">Current Path:</div>
                    <q-input
                        v-model="currentPath"
                        dense
                        readonly
                        filled
                        class="current-path-input"
                        bg-color="grey-2"
                    >
                        <template v-slot:prepend>
                            <q-icon name="folder" color="primary" />
                        </template>
                    </q-input>
                    <q-btn
                        flat
                        color="primary"
                        icon="create_new_folder"
                        label="New Folder"
                        class="q-mt-sm"
                        @click="promptNewFolder"
                    />
                </div>

                <q-list bordered separator class="directory-list">
                    <q-item
                        v-for="item in sortedItems"
                        :key="item.path"
                        clickable
                        v-ripple
                        @click="item.isDirectory ? navigateToFolder(item.path) : null"
                        class="directory-item"
                    >
                        <q-item-section avatar>
                            <q-icon
                                :name="getItemIcon(item)"
                                :color="getItemColor(item)"
                                size="sm"
                            />
                        </q-item-section>
                        <q-item-section>
                            {{ item.name }}
                        </q-item-section>
                        <q-item-section side v-if="item.isDirectory">
                            <q-icon name="chevron_right" color="grey-6" size="xs" />
                        </q-item-section>
                    </q-item>
                </q-list>
            </q-card-section>

            <q-card-actions align="right" class="action-buttons">
                <q-btn
                    flat
                    label="Cancel"
                    color="grey-7"
                    v-close-popup
                    class="q-px-md"
                />
                <q-btn
                    unelevated
                    label="Select"
                    color="primary"
                    @click="selectCurrentFolder"
                    class="q-px-md q-ml-sm"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>

    <!-- Add new folder dialog -->
    <q-dialog v-model="newFolderDialog" persistent>
        <q-card style="min-width: 300px">
            <q-card-section class="row items-center">
                <div class="text-h6">Create New Folder</div>
            </q-card-section>

            <q-card-section>
                <q-input
                    v-model="newFolderName"
                    label="Folder Name"
                    dense
                    autofocus
                    @keyup.enter="createNewFolder"
                />
            </q-card-section>

            <q-card-actions align="right">
                <q-btn flat label="Cancel" color="grey-7" v-close-popup />
                <q-btn flat label="Create" color="primary" @click="createNewFolder" />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script>

export default {
    name: 'FolderBrowser',
    props: {
        modelValue: {
            type: Boolean,
            required: true
        },
        initialPath: {
            type: String,
            default: ''
        }
    },
    data() {
        return {
            currentPath: '',
            items: [],
            newFolderDialog: false,
            newFolderName: ''
        }
    },
    computed: {
        isOpen: {
            get() {
                return this.modelValue
            },
            set(value) {
                this.$emit('update:modelValue', value)
            }
        },
        sortedItems() {
            return this.items;
        }
    },
    methods: {
        async navigateToFolder(folderPath) {
            await this.loadFolderContents(folderPath);
        },

        async loadFolderContents(path) {
            try {
                const response = await this.$api.post('/api/browse-folders', {
                    currentPath: path
                });

                if (response.data) {
                    this.currentPath = response.data.currentPath;
                    this.items = response.data.items || [];
                }
            } catch (error) {
                console.error('Error loading folder contents:', error);
                this.$q.notify({
                    type: 'negative',
                    message: 'Error loading folder contents'
                });
            }
        },

        selectCurrentFolder() {
            this.$emit('folder-selected', this.currentPath);
            this.isOpen = false;
        },

        getItemIcon(item) {
            if (item.isParent) return 'reply';
            if (item.isDirectory) return 'folder';
            return 'insert_drive_file';
        },

        getItemColor(item) {
            if (item.isParent) return 'grey-7';
            if (item.isDirectory) return 'primary';
            return 'grey-6';
        },

        promptNewFolder() {
            this.newFolderName = '';
            this.newFolderDialog = true;
        },

        async createNewFolder() {
            if (this.newFolderName.trim()) {
                const newFolderPath = `${this.currentPath}/${this.newFolderName}`;

                try {
                    await this.$api.post('/api/create-folder', {
                        folderPath: newFolderPath
                    });

                    // Refresh the current directory to show the new folder
                    await this.loadFolderContents(this.currentPath);
                    this.newFolderDialog = false;

                    this.$q.notify({
                        type: 'positive',
                        message: 'Folder created successfully'
                    });
                } catch (error) {
                    console.error('Error creating folder:', error);
                    this.$q.notify({
                        type: 'negative',
                        message: 'Error creating folder'
                    });
                }
            }
        }
    },
    async mounted() {
        await this.loadFolderContents(this.initialPath || './');
    }
}
</script>

<style scoped>
.folder-browser-card {
    min-width: 600px;
    max-width: 900px;
    border-radius: 4px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.header-section {
    background-color: var(--q-primary);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding: 16px 20px;
}

.path-section {
    margin-bottom: 16px;
}

.current-path-input {
    font-family: monospace;
    font-size: 13px;
}

.directory-list {
    max-height: 450px;
    overflow-y: auto;
    border-radius: 4px;
    border: 1px solid #e0e0e0;
}

.directory-item {
    transition: background-color 0.15s;
    min-height: 40px;
}

.directory-item:hover {
    background-color: #f5f9ff;
}

.action-buttons {
    padding: 12px 20px;
    border-top: 1px solid #e0e0e0;
    background-color: #fafafa;
}
</style>
