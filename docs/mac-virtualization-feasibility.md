# MAC address: feasibility report and gated design (Phase 3)

Status: **report only.** Nothing in AZWAH changes a host or virtual network adapter. Any implementation needs separate owner approval.

## A. Browser-only profiles (implemented as an explanation)

- Websites cannot read the network adapter's MAC address through standard browser APIs. WebRTC exposes IP candidates, not hardware addresses, and AZWAH already restricts those with the WebRTC policy.
- A Chrome or Firefox profile has no network adapter of its own. Every profile on a computer shares that computer's adapters.
- The editor's Fingerprint tab → **Device identity** → "MAC address" note says this. No MAC field exists for browser profiles. The Details dialog keeps "MAC isolation: Unavailable" for native runtimes.
- Starting a profile never changes the host's Wi-Fi or Ethernet MAC address.

## B. Optional isolated virtual environment (future, gated)

### What a real MAC per environment requires

One **virtual network interface per isolated environment**, not per browser profile. It needs its own network stack (a VM, or a container with its own network namespace) whose traffic leaves through that interface.

### Candidate architectures

| Option | Host requirement | Per-environment MAC | Effort | Fit |
|---|---|---|---|---|
| Hyper-V VM per environment (Windows 10/11 Pro/Enterprise) | Hyper-V enabled, admin rights, hardware virtualization | Static MAC on the VM's virtual NIC (`Set-VMNetworkAdapter -StaticMacAddress`) | High: VM images, a browser inside each VM, remote control into AZWAH | Strongest isolation; heavy |
| WSL2 or Linux network namespace with a `macvlan`/`veth` interface | Linux kernel or WSL2, root inside the distribution | `ip link set dev X address …` on the virtual interface | Medium | A Linux browser inside the namespace; not a Windows Chrome profile |
| VirtualBox or VMware VM | Third-party hypervisor installed | Per-VM NIC MAC | High | As Hyper-V, plus a dependency |
| Change the physical adapter's MAC | Admin | Host-wide, one at a time | Low | **Rejected:** affects the whole computer, breaks DHCP and network access, and is not per profile |

### Gated design (if approved)

1. **Opt-in "Virtual environment" object**, separate from browser profiles. It has a name, an image, a virtual NIC and a MAC. The editor never implies a normal profile has one.
2. **MAC validation:** locally administered unicast only (second-least-significant bit of the first octet set, multicast bit clear, for example `x2:`, `x6:`, `xA:`, `xE:`). Reject all-zero and broadcast addresses. Check for collisions against every environment and the host's adapters.
3. **Privileges:** document the admin and Hyper-V requirements, and request elevation once per create/destroy, never per launch.
4. **Lifecycle:** create, start and stop with a journal (reuse `server/recovery-journal.js`), so a crash leaves no orphaned interface. Delete removes the virtual switch port and the NIC.
5. **Verification:** read the MAC back from the virtual interface (`Get-VMNetworkAdapter`, or `ip link` inside the namespace), never from the browser DOM. Show `verified` only after the readback matches.
6. **Honesty:** state that a proxy hides local-network details from public websites anyway, and that a virtual MAC alone is not an anonymity guarantee.

### Infrastructure assessment

- Hyper-V guests on GitHub's free `windows-2022` runners are not a documented, supported configuration, because they would require nested virtualization. So the VM path **cannot be relied on in the current free CI**. It would need a self-hosted Windows runner with Hyper-V, or the owner's machine.
- The Linux namespace path could be unit-tested on Linux runners with root, but it would not cover the Windows Chrome Stable product.

### Recommendation

**Deferred.** Keep A (honest explanation, no MAC field). Revisit B only with approval for either a self-hosted Hyper-V test machine or a Linux-only "isolated environment" feature. Either is a separate product surface from browser profiles.
