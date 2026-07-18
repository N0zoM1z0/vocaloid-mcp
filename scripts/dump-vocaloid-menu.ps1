param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId
)

$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class VocaloidMenuApi {
    [DllImport("user32.dll")]
    public static extern IntPtr GetMenu(IntPtr window);

    [DllImport("user32.dll")]
    public static extern IntPtr GetSubMenu(IntPtr menu, int position);

    [DllImport("user32.dll")]
    public static extern int GetMenuItemCount(IntPtr menu);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetMenuString(
        IntPtr menu,
        uint item,
        StringBuilder text,
        int maxCount,
        uint flags
    );

    [DllImport("user32.dll")]
    public static extern uint GetMenuItemID(IntPtr menu, int position);

    [DllImport("user32.dll")]
    public static extern uint GetMenuState(IntPtr menu, uint item, uint flags);
}
"@

function Read-Menu {
    param(
        [IntPtr]$Menu,
        [string]$ParentPath
    )

    $count = [VocaloidMenuApi]::GetMenuItemCount($Menu)
    for ($position = 0; $position -lt $count; $position++) {
        $text = New-Object System.Text.StringBuilder 512
        [VocaloidMenuApi]::GetMenuString(
            $Menu,
            [uint32]$position,
            $text,
            $text.Capacity,
            0x00000400
        ) | Out-Null
        $label = $text.ToString()
        $path = if ($ParentPath) { "$ParentPath > $label" } else { $label }
        $submenu = [VocaloidMenuApi]::GetSubMenu($Menu, $position)
        $id = [VocaloidMenuApi]::GetMenuItemID($Menu, $position)
        $state = [VocaloidMenuApi]::GetMenuState(
            $Menu,
            [uint32]$position,
            0x00000400
        )

        [pscustomobject]@{
            Path = $path
            Position = $position
            CommandId = if ($id -eq [uint32]::MaxValue) { $null } else { $id }
            HasSubmenu = $submenu -ne [IntPtr]::Zero
            Enabled = ($state -band 0x00000003) -eq 0
            Checked = ($state -band 0x00000008) -ne 0
        }

        if ($submenu -ne [IntPtr]::Zero) {
            Read-Menu -Menu $submenu -ParentPath $path
        }
    }
}

$process = Get-Process -Id $ProcessId -ErrorAction Stop
$menu = [VocaloidMenuApi]::GetMenu($process.MainWindowHandle)
if ($menu -eq [IntPtr]::Zero) {
    throw "Process $ProcessId has no standard Win32 menu."
}

Read-Menu -Menu $menu -ParentPath ""
